import { test } from "node:test";
import assert from "node:assert/strict";
import type { Database } from "../../src/server/db-contract";
import {
  configureRuntimeLogging,
  runtimeLoggingPolicy,
} from "../../src/server/runtime-logging";

test("logging update is fixed-role, snapshots before changes and grants no privileges", async () => {
  const calls: string[] = [];
  let scoped = true;
  const db: Database = {
    async transaction(work) {
      calls.push("BEGIN");
      return work(db);
    },
    async exec(sql) {
      calls.push(sql);
    },
    async query<T>(sql: string) {
      calls.push(sql);
      return {
        rows: (sql.includes("AS allowed")
          ? [{ allowed: scoped }]
          : [{ config: [] }]) as T[],
      };
    },
  };
  const result = await configureRuntimeLogging(db, async (snapshot) => {
    calls.push("snapshot");
    assert.equal(snapshot.role, "jco_admin_reader");
    assert.deepEqual(snapshot.settings, []);
  });
  assert.equal(result.settingsUpdated, runtimeLoggingPolicy.length);
  assert.ok(
    calls.indexOf("snapshot") <
      calls.findIndex((sql) => sql.startsWith("ALTER ROLE")),
  );
  assert.ok(
    calls
      .filter((sql) => sql.startsWith("ALTER ROLE"))
      .every((sql) => sql.startsWith("ALTER ROLE jco_admin_reader SET ")),
  );
  assert.ok(
    !calls.some((sql) =>
      /GRANT|ALTER SYSTEM|DELETE|TRUNCATE|pg_terminate_backend/i.test(sql),
    ),
  );
  scoped = false;
  const before = calls.length;
  await assert.rejects(
    configureRuntimeLogging(db, async () => {
      throw Error("Must not snapshot");
    }),
    /scope/,
  );
  assert.equal(
    calls.slice(before).filter((sql) => sql.startsWith("ALTER ROLE")).length,
    0,
  );
});

test("snapshot failure aborts before role configuration changes", async () => {
  const changes: string[] = [];
  const db: Database = {
    async transaction(work) {
      return work(db);
    },
    async exec(sql) {
      changes.push(sql);
    },
    async query<T>(sql: string) {
      return {
        rows: (sql.includes("AS allowed")
          ? [{ allowed: true }]
          : [{ config: [] }]) as T[],
      };
    },
  };
  await assert.rejects(
    configureRuntimeLogging(db, async () => {
      throw Error("snapshot unavailable");
    }),
    /snapshot unavailable/,
  );
  assert.ok(!changes.some((sql) => sql.startsWith("ALTER ROLE")));
});
