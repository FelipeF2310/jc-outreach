import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { postgresDatabase } from "../../src/server/postgres";
import { prepareHosted } from "../../src/server/prepare-hosted";
import { listHostedCampaigns } from "../../src/server/hosted-campaigns";
import { finalizeImport } from "../../src/server/import-service";
import {
  rehearsalCsv,
  assignRehearsal,
} from "../../src/server/import-rehearsal";
import { validateImport } from "../../src/server/import-validation";
import { downloadAssignment, submitOperation } from "../../src/server/service";

let directory: string, bin: string, pool: Pool, reader: Pool;
let started = false;
before(async () => {
  bin =
    process.env.JCO_TEST_POSTGRES_BIN ??
    execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim();
  directory = await mkdtemp("/tmp/jco-pg-");
  execFileSync(
    join(bin, "initdb"),
    [
      "-D",
      join(directory, "data"),
      "-U",
      "jco_test_owner",
      "--auth-local=trust",
      "--auth-host=reject",
      "--encoding=UTF8",
      "--no-locale",
    ],
    { stdio: "pipe" },
  );
  // Unix socket only in a randomly named 0700 task-owned directory. No TCP listener.
  execFileSync(
    join(bin, "pg_ctl"),
    [
      "-D",
      join(directory, "data"),
      "-l",
      join(directory, "server.log"),
      "-o",
      `-k ${directory} -h '' -p 55439`,
      "-w",
      "start",
    ],
    { stdio: "pipe" },
  );
  started = true;
  pool = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco_test_owner",
    max: 4,
  });
  reader = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco_admin_reader",
  });
});
after(async () => {
  await reader?.end();
  await pool?.end();
  if (started)
    execFileSync(
      join(bin, "pg_ctl"),
      ["-D", join(directory, "data"), "-m", "fast", "-w", "stop"],
      { stdio: "pipe" },
    );
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("fresh hosted bootstrap is atomic, cannot reset an existing namespace, and enforces read-only runtime permissions", async () => {
  const db = postgresDatabase(pool);
  await pool.query(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS",
  );
  await pool.query(
    "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon, authenticated, service_role",
  );
  await prepareHosted(db);
  const id = randomUUID();
  await db.query(
    "INSERT INTO outreach.campaigns VALUES ($1,'Synthetic hosted rehearsal',now()+interval '30 days')",
    [id],
  );
  await db.query(
    "INSERT INTO outreach.campaigns VALUES ($1,'Expired synthetic rehearsal',now()-interval '1 day')",
    [randomUUID()],
  );
  const result = await listHostedCampaigns(postgresDatabase(reader));
  assert.deepEqual(
    result.map((c) => c.id),
    [id],
  );
  await assert.rejects(() => prepareHosted(db), /empty outreach namespace/);
  assert.equal((await listHostedCampaigns(postgresDatabase(reader))).length, 1);
  for (const sql of [
    "SELECT * FROM outreach.people",
    "SELECT * FROM outreach.credentials",
    "DELETE FROM outreach.campaigns",
    "CREATE TABLE outreach.evil(id int)",
    "UPDATE outreach.deployment SET stage='production'",
  ]) {
    await assert.rejects(() => reader.query(sql), /permission denied/);
  }
  assert.equal(
    (await reader.query("SELECT * FROM outreach.campaigns")).rowCount,
    1,
    "RLS hides expired campaigns even without app WHERE clause",
  );
  await assert.rejects(() => listHostedCampaigns(db), /runtime role/);
  const publicAccess = await db.query<{ allowed: boolean }>(
    "SELECT has_schema_privilege('public','outreach','USAGE') AS allowed",
  );
  assert.equal(publicAccess.rows[0].allowed, false);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${role}`);
      await assert.rejects(
        () => client.query("SELECT * FROM outreach.campaigns"),
        /permission denied/,
      );
    } finally {
      await client.query("RESET ROLE");
      client.release();
    }
  }
});

test("real pg adapter preserves imported hierarchy, concurrent idempotency, dates and atomic rollback", async () => {
  const db = postgresDatabase(pool),
    campaign = randomUUID();
  await db.query(
    "INSERT INTO outreach.campaigns VALUES ($1,'Synthetic adapter test',now()+interval '30 days')",
    [campaign],
  );
  await db.query(
    "INSERT INTO outreach.import_rehearsals(campaign_id,end_at) VALUES ($1,now()+interval '1 day')",
    [campaign],
  );
  const bytes = rehearsalCsv("valid-couple-and-buildings"),
    digest = validateImport(bytes).preview.digest!;
  const [a, b] = await Promise.all([
    finalizeImport(db, campaign, bytes, digest),
    finalizeImport(db, campaign, bytes, digest),
  ]);
  assert.equal(a.importId, b.importId);
  const assigned = await assignRehearsal(db, campaign);
  const assignment = await downloadAssignment(db, assigned.token);
  assert.equal(assignment.households.length, 3);
  assert.ok(assignment.households.some((h) => h.people.length === 2));
  const operation = {
    schemaVersion: 1,
    id: randomUUID(),
    assignmentId: assignment.id,
    createdAt: new Date().toISOString(),
    kind: "visit",
    visitId: randomUUID(),
    householdId: assignment.households[0].id,
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  };
  const [first, retry] = await Promise.all([
    submitOperation(db, assigned.token, operation),
    submitOperation(db, assigned.token, operation),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(
    (
      await db.query("SELECT id FROM outreach.visits WHERE id=$1", [
        operation.visitId,
      ])
    ).rows.length,
    1,
  );
  await assert.rejects(() =>
    db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO outreach.campaigns VALUES ($1,'Must roll back',now())",
        [randomUUID()],
      );
      await tx.query("SELECT 1/0");
    }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM outreach.campaigns WHERE name='Must roll back'",
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await db.query<{ ok: number }>("SELECT 1 AS ok")).rows[0].ok,
    1,
    "pool remains usable after rollback",
  );
});

test("a late bootstrap role collision rolls back the entire new namespace", async () => {
  await pool.query("CREATE DATABASE synthetic_bootstrap_failure");
  const other = new Pool({
    host: directory,
    port: 55439,
    database: "synthetic_bootstrap_failure",
    user: "jco_test_owner",
  });
  try {
    await assert.rejects(
      () => prepareHosted(postgresDatabase(other)),
      /already exists/,
    );
    const result = await other.query(
      "SELECT 1 FROM pg_namespace WHERE nspname='outreach'",
    );
    assert.equal(result.rowCount, 0);
  } finally {
    await other.end();
  }
});
