import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enableRetentionSchedule,
  RETENTION_COMMAND,
  RETENTION_JOB,
} from "../../src/server/retention-schedule";
import { readRetentionStatus } from "../../src/server/admin-retention";
import type { Database } from "../../src/server/db-contract";

function fixture() {
  const settings = {
    stage: "synthetic-preview",
    installed: true,
    cron: true,
    overdue: 0,
  };
  const jobs: {
    jobid: number;
    schedule: string;
    command: string;
    active: boolean;
    database: string;
  }[] = [];
  const scheduled: unknown[][] = [];
  const db: Database = {
    async query<T>(sql: string, params?: unknown[]) {
      let rows: unknown[] = [];
      if (sql.includes("FROM outreach.deployment")) rows = [settings];
      else if (sql.includes("count(*)")) rows = [{ n: settings.overdue }];
      else if (sql.includes("FROM cron.job")) rows = jobs;
      else if (sql.includes("current_database")) rows = [{ name: "postgres" }];
      else if (sql.includes("cron.schedule($1")) scheduled.push(params!);
      else assert.match(sql, /pg_advisory_xact_lock/);
      return { rows: rows as T[] };
    },
    async exec() {
      throw Error("No arbitrary SQL batch expected");
    },
    async transaction(work) {
      return work(db);
    },
  };
  return { settings, jobs, scheduled, db };
}
test("schedule installation is explicit, narrow and never silently overwrites an existing job", async () => {
  const f = fixture();
  assert.deepEqual(await enableRetentionSchedule(f.db), {
    configured: true,
    existing: false,
  });
  assert.deepEqual(f.scheduled, [
    [RETENTION_JOB, "* * * * *", RETENTION_COMMAND],
  ]);
  f.jobs.push({
    jobid: 1,
    schedule: "* * * * *",
    command: RETENTION_COMMAND,
    active: true,
    database: "postgres",
  });
  assert.deepEqual(await enableRetentionSchedule(f.db), {
    configured: true,
    existing: true,
  });
  assert.equal(f.scheduled.length, 1);
  for (const change of [
    { active: false },
    { command: "SELECT other_job()" },
    { schedule: "0 * * * *" },
    { database: "other" },
  ]) {
    const original = { ...f.jobs[0] };
    Object.assign(f.jobs[0], change);
    await assert.rejects(enableRetentionSchedule(f.db), /without overwriting/);
    f.jobs[0] = original;
  }
  assert.equal(f.scheduled.length, 1);
});
test("schedule refuses an unprepared stage, missing Cron, or already-expired targets", async () => {
  for (const change of [
    { stage: "production" },
    { installed: false },
    { cron: false },
    { overdue: 1 },
  ]) {
    const f = fixture();
    Object.assign(f.settings, change);
    await assert.rejects(enableRetentionSchedule(f.db));
    assert.equal(f.scheduled.length, 0);
  }
});
test("retention read rejects extra authority, mutations and invalid IDs before querying", async () => {
  let opened = 0;
  const db: Database = {
    async query() {
      throw Error();
    },
    async exec() {
      throw Error();
    },
    async transaction() {
      opened++;
      throw Error();
    },
  };
  for (const input of [
    { campaignId: "invalid" },
    { campaignId: null, delete: true },
    { campaignId: null, actor: "owner" },
    { campaignId: null, deletionAt: "2000-01-01" },
    {},
  ])
    await assert.rejects(readRetentionStatus(db, input), /valid campaign/);
  assert.equal(opened, 0);
});
