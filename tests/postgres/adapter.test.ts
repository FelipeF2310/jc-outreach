import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { postgresDatabase } from "../../src/server/postgres";
import { prepareHosted } from "../../src/server/prepare-hosted";
import { listHostedCampaigns } from "../../src/server/hosted-campaigns";
import { verifyReader } from "../../src/server/verify-reader";
import { migrateCampaigns } from "../../src/server/migrate-campaigns";
import { migrateImports } from "../../src/server/migrate-imports";
import { migrateAssignments } from "../../src/server/migrate-assignments";
import { assignmentAdmin } from "../../src/server/assignment-admin";
import { migrateField } from "../../src/server/migrate-field";
import { migrateLinkLabels } from "../../src/server/migrate-link-labels";
import { migrateHelpQueue } from "../../src/server/migrate-help-queue";
import { helpAdmin } from "../../src/server/admin-help";
import { correctionAdmin } from "../../src/server/admin-corrections";
import { migrateCorrectionQueue } from "../../src/server/migrate-correction-queue";
import { migrateReassignment } from "../../src/server/migrate-reassignment";
import { migrateCompletion } from "../../src/server/migrate-completion";
import { migrateRetention } from "../../src/server/migrate-retention";
import { readRetentionStatus } from "../../src/server/admin-retention";
import type { CompletionReport } from "../../src/lib/completion-contracts";
import {
  downloadHostedAssignment,
  submitHostedOperation,
  hostedFieldAdmin,
  submitHostedCompletion,
} from "../../src/server/hosted-field";
import { DomainError, type VisitOperation } from "../../src/lib/contracts";
import { hashToken } from "../../src/server/service";
import { hostedImport } from "../../src/server/hosted-imports";
import { createHostedCampaign } from "../../src/server/hosted-campaigns";
import { ownerPreflight } from "../../src/server/owner-preflight";
import { configureRuntimeLogging } from "../../src/server/runtime-logging";
import { importCsvBytes } from "../../src/server/csv-intake";
import { migrateLive } from "../../src/server/migrate-live";
import { preloadLiveCampaign } from "../../src/server/live-preload";
import { sourceHeaders } from "../../src/lib/import-contracts";
import importFixture from "../fixtures/outreach.json";
import { migrate } from "../../src/server/migrate";
import { inspectUploadLogging } from "../../src/server/upload-safety";
import { finalizeImport } from "../../src/server/import-service";
import {
  rehearsalCsv,
  assignRehearsal,
} from "../../src/server/import-rehearsal";
import { validateImport } from "../../src/server/import-validation";
import { downloadAssignment, submitOperation } from "../../src/server/service";
import {
  prepareRetentionRehearsal,
  inspectRetentionRehearsal,
  verifyDeletedCredential,
  retentionTables,
} from "../../scripts/lib/retention-rehearsal";
import type { Database } from "../../src/server/db-contract";
import {
  RETENTION_COMMAND,
  RETENTION_JOB,
} from "../../src/server/retention-schedule";

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
  const preflight = await ownerPreflight(db);
  assert.equal(
    preflight.connected_as_owner,
    false,
    "synthetic test account is deliberately not named postgres",
  );
  assert.equal(preflight.owns_campaign_table, true);
  assert.equal(preflight.synthetic_stage, true);
  assert.equal(preflight.campaign_update_recorded, false);
  assert.equal(
    (
      await pool.query(
        "SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='jco_campaign_executor') AS present",
      )
    ).rows[0].present,
    false,
    "read-only preflight does not run the campaign migration",
  );
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
  assert.deepEqual(await verifyReader(postgresDatabase(reader)), {
    campaignCount: 1,
  });
  await assert.rejects(() => verifyReader(db), /Reader privileges/);
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

test("reader preflight detects unexpected column access, disabled RLS and role membership", async () => {
  for (const [grant, revoke] of [
    [
      "GRANT SELECT (id) ON outreach.people TO jco_admin_reader",
      "REVOKE SELECT (id) ON outreach.people FROM jco_admin_reader",
    ],
    [
      "ALTER TABLE outreach.campaigns DISABLE ROW LEVEL SECURITY",
      "ALTER TABLE outreach.campaigns ENABLE ROW LEVEL SECURITY",
    ],
    ["GRANT anon TO jco_admin_reader", "REVOKE anon FROM jco_admin_reader"],
  ]) {
    await pool.query(grant);
    try {
      await assert.rejects(
        () => verifyReader(postgresDatabase(reader)),
        /Reader privileges/,
      );
    } finally {
      await pool.query(revoke);
    }
  }
  await verifyReader(postgresDatabase(reader));
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

test("additive campaign migration preserves data and only grants a bounded creation function", async () => {
  const owner = postgresDatabase(pool),
    runtime = postgresDatabase(reader);
  const before = await pool.query(
    "SELECT count(*)::int AS count FROM outreach.campaigns",
  );
  // Match the important managed-hosting constraint: migration owner is not a superuser.
  // A non-simple identifier also exercises the explicit, quoted membership grant.
  await pool.query('CREATE ROLE "jco-test-migrator" LOGIN CREATEROLE');
  await pool.query('ALTER SCHEMA outreach OWNER TO "jco-test-migrator"');
  await pool.query(`DO $ownership$ DECLARE item record; BEGIN
    FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='outreach' LOOP
      EXECUTE format('ALTER TABLE outreach.%I OWNER TO "jco-test-migrator"',item.tablename);
    END LOOP; END $ownership$`);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateCampaigns(postgresDatabase(migrator));
    await migrateCampaigns(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  assert.deepEqual(
    (await pool.query("SELECT count(*)::int AS count FROM outreach.campaigns"))
      .rows,
    before.rows,
  );
  await verifyReader(runtime);
  for (const sql of [
    "INSERT INTO outreach.campaigns(id,name,deletion_at) VALUES(gen_random_uuid(),'Bypass',now())",
    "UPDATE outreach.campaigns SET name='Bypass'",
    "DELETE FROM outreach.campaigns",
    "SELECT * FROM outreach.people",
    "SELECT * FROM outreach.credentials",
    "SET ROLE jco_campaign_executor",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = await pool.query(
      "SELECT has_function_privilege($1,'outreach.create_synthetic_campaign(uuid,text,date,uuid)','EXECUTE') AS allowed",
      [role],
    );
    assert.equal(access.rows[0].allowed, false);
  }
  const actor = randomUUID();
  const input = {
    id: randomUUID(),
    name: "Ward A practice",
    endDate: "2030-02-20",
  };
  await assert.rejects(
    () => createHostedCampaign(owner, input, actor),
    /runtime role/,
  );
  const [first, retry] = await Promise.all([
    createHostedCampaign(runtime, input, actor),
    createHostedCampaign(runtime, input, actor),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(first.name, "Synthetic: Ward A practice");
  assert.equal(first.endAt, "2030-02-21T04:59:59.000Z");
  assert.equal(first.deletionAt, "2030-03-23T03:59:59.000Z");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.campaigns WHERE id=$1",
        [input.id],
      )
    ).rows[0].count,
    1,
  );
  assert.ok(
    (await listHostedCampaigns(runtime)).some(
      (row) => row.id === first.id && row.endAt === first.endAt,
    ),
  );
  for (const changed of [
    { ...input, name: "Changed" },
    { ...input, endDate: "2030-02-21" },
  ])
    await assert.rejects(
      () => createHostedCampaign(runtime, changed, actor),
      /conflicts/,
    );
  await assert.rejects(
    () => createHostedCampaign(runtime, input, randomUUID()),
    /conflicts/,
  );
  const autumn = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Fall practice", endDate: "2030-10-20" },
    actor,
  );
  assert.equal(autumn.endAt, "2030-10-21T03:59:59.000Z");
  assert.equal(autumn.deletionAt, "2030-11-20T04:59:59.000Z");
  await assert.rejects(
    () =>
      createHostedCampaign(
        runtime,
        { id: randomUUID(), name: "Past", endDate: "2001-01-01" },
        actor,
      ),
    /has not passed/,
  );
  await assert.rejects(
    () =>
      reader.query(
        "SELECT * FROM outreach.create_synthetic_campaign($1,$2,$3,$4)",
        [randomUUID(), "", "2030-10-20", actor],
      ),
    /Invalid campaign/,
  );
  // Restricted function owner cannot read residents either; no database-owner execution.
  const client = await pool.connect();
  try {
    await client.query("SET ROLE jco_campaign_executor");
    await assert.rejects(
      () => client.query("SELECT * FROM outreach.people"),
      /permission denied/,
    );
    await assert.rejects(
      () => client.query("UPDATE outreach.campaigns SET name='Bypass'"),
      /permission denied/,
    );
  } finally {
    await client.query("RESET ROLE");
    client.release();
  }
});

test("hosted synthetic imports are narrow, atomic, minimized and repeatable after reload", async () => {
  const runtime = postgresDatabase(reader);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateImports(postgresDatabase(migrator));
    await migrateImports(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const actor = randomUUID();
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Import practice", endDate: "2030-05-01" },
    actor,
  );
  const selected = {
    campaignId: campaign.id,
    caseId: "valid-couple-and-buildings",
  };
  const { preview: expected, rows: expectedRows } = validateImport(
    rehearsalCsv(selected.caseId),
  );
  const result = await hostedImport(
    runtime,
    { ...selected, action: "preview" },
    actor,
  );
  assert.deepEqual(result, { preview: expected });
  for (const caseId of [
    "tier-three",
    "unknown-tier",
    "blank-tier",
    "conflicting-unit",
  ]) {
    const bad = await hostedImport(
      runtime,
      { ...selected, caseId, action: "preview" },
      actor,
    );
    assert.ok(
      bad.preview && !bad.preview.valid && bad.preview.households.length === 0,
    );
    await assert.rejects(
      () =>
        hostedImport(
          runtime,
          {
            ...selected,
            caseId,
            action: "finalize",
            confirmed: true,
            digest: expected.digest,
          },
          actor,
        ),
      /Import rejected/,
    );
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.imports WHERE campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].n,
    0,
  );
  const input = {
    ...selected,
    action: "finalize",
    confirmed: true,
    digest: expected.digest,
  };
  await assert.rejects(
    () => hostedImport(runtime, { ...input, digest: "0".repeat(64) }, actor),
    /Preview changed/,
  );
  await assert.rejects(
    () => hostedImport(runtime, { ...input, campaignId: randomUUID() }, actor),
    /unavailable/,
  );
  const [first, retry] = await Promise.all([
    hostedImport(runtime, input, actor),
    hostedImport(runtime, input, actor),
  ]);
  assert.deepEqual(first, retry);
  assert.ok(first.receipt);
  assert.deepEqual(first.receipt.counts, {
    people: 4,
    households: 3,
    buildings: 2,
  });
  const restored = (await listHostedCampaigns(runtime)).find(
    (value) => value.id === campaign.id,
  );
  assert.deepEqual(restored?.importReceipt, first.receipt);
  assert.equal(restored?.importReady, true);
  const actual = await pool.query(
    `SELECT p.first_name AS "First Name",p.last_name AS "Last Name",i.source_id AS "VANID",i.residence_address AS "Residence Address",i.zip AS "Zip",i.ward AS "Ward",i.block AS "Block",i.lot AS "Lot",i.qual AS "Qual",i.property_location AS "Property Location",i.verified_unit AS "Unit (verified)",i.tier AS "Tier",i.household_key AS "Household Key" FROM outreach.import_people i JOIN outreach.people p ON p.id=i.person_id WHERE i.campaign_id=$1 ORDER BY i.source_id`,
    [campaign.id],
  );
  assert.deepEqual(actual.rows, expectedRows);
  const grouped = await pool.query(
    "SELECT h.id,count(p.id)::int AS people FROM outreach.households h JOIN outreach.people p ON p.household_id=h.id WHERE h.campaign_id=$1 GROUP BY h.id ORDER BY people",
    [campaign.id],
  );
  assert.deepEqual(
    grouped.rows.map((value) => value.people),
    [1, 1, 2],
  );
  assert.equal(
    (
      await pool.query(
        "SELECT finalized_by FROM outreach.imports WHERE campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].finalized_by,
    actor,
  );
  for (const sql of [
    "SELECT * FROM outreach.people",
    "SELECT * FROM outreach.import_people",
    "SELECT * FROM outreach.imports",
    "SET ROLE jco_import_executor",
    "DELETE FROM outreach.households",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const allowed = await pool.query(
      "SELECT has_function_privilege($1,'outreach.finalize_synthetic_import(uuid,text,uuid)','EXECUTE') AS finalize,has_function_privilege($1,'outreach.synthetic_import_status()','EXECUTE') AS status",
      [role],
    );
    assert.deepEqual(allowed.rows[0], { finalize: false, status: false });
  }
  await assert.rejects(
    () =>
      reader.query("SELECT outreach.finalize_synthetic_import($1,$2,$3)", [
        campaign.id,
        "bad",
        actor,
      ]),
    /Approved synthetic/,
  );

  const rollback = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Atomic import", endDate: "2030-05-01" },
    actor,
  );
  await pool.query(
    "ALTER TABLE outreach.people ADD CONSTRAINT synthetic_test_failure CHECK(first_name <> 'Resident D') NOT VALID",
  );
  try {
    await assert.rejects(
      () => hostedImport(runtime, { ...input, campaignId: rollback.id }, actor),
      /synthetic_test_failure/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.imports WHERE campaign_id=$1",
          [rollback.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.households WHERE campaign_id=$1",
          [rollback.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.buildings WHERE campaign_id=$1",
          [rollback.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await pool.query(
      "ALTER TABLE outreach.people DROP CONSTRAINT synthetic_test_failure",
    );
  }
  await hostedImport(runtime, { ...input, campaignId: rollback.id }, actor);
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=(now()-interval '31 days'), deletion_at=(((now()-interval '31 days') AT TIME ZONE 'America/New_York')+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [rollback.id],
  );
  await assert.rejects(
    () => hostedImport(runtime, { ...input, campaignId: rollback.id }, actor),
    /unavailable/,
  );
  assert.ok(
    !(await listHostedCampaigns(runtime)).some(
      (value) => value.id === rollback.id,
    ),
  );
});

test("event and assignment preparation preserves scope, ordering, retries and exclusive doors", async () => {
  const runtime = postgresDatabase(reader);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateAssignments(postgresDatabase(migrator));
    await migrateAssignments(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const actor = randomUUID();
  async function imported(name: string) {
    const c = await createHostedCampaign(
      runtime,
      { id: randomUUID(), name, endDate: "2030-05-01" },
      actor,
    );
    const { preview } = validateImport(
      rehearsalCsv("valid-couple-and-buildings"),
    );
    await hostedImport(
      runtime,
      {
        action: "finalize",
        campaignId: c.id,
        caseId: "valid-couple-and-buildings",
        digest: preview.digest,
        confirmed: true,
      },
      actor,
    );
    return c;
  }
  const campaign = await imported("Assignment practice");
  const other = await imported("Other campaign");
  const first = await assignmentAdmin(
    runtime,
    { action: "workspace", campaignId: campaign.id },
    actor,
  );
  assert.equal(first.workspace.households.length, 3);
  assert.deepEqual(
    first.workspace.households.map((h) => h.peopleCount),
    [2, 1, 1],
  );
  assert.deepEqual(
    first.workspace.households.map((h) => h.unit),
    ["2A", "10B", ""],
  );
  assert.doesNotMatch(
    JSON.stringify(first.workspace),
    /VANID|source_id|Match Rationale|Resident A|token_hash/,
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        postgresDatabase(pool),
        { action: "workspace", campaignId: campaign.id },
        actor,
      ),
    /runtime role/,
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { action: "workspace", campaignId: randomUUID() },
        actor,
      ),
    /unavailable/,
  );
  const event = {
    action: "event",
    id: randomUUID(),
    campaignId: campaign.id,
    name: "Saturday practice",
    endDate: "2030-04-20",
  };
  const [created, replayed] = await Promise.all([
    assignmentAdmin(runtime, event, actor),
    assignmentAdmin(runtime, event, actor),
  ]);
  assert.equal(created.savedId, event.id);
  assert.deepEqual(created, replayed);
  assert.equal(
    new Date(created.workspace.events[0].endsAt).toISOString(),
    "2030-04-20T21:00:00.000Z",
  );
  for (const changed of [
    { ...event, name: "Different" },
    { ...event, endDate: "2030-04-21" },
  ])
    await assert.rejects(
      () => assignmentAdmin(runtime, changed, actor),
      /different details/,
    );
  await assert.rejects(
    () => assignmentAdmin(runtime, event, randomUUID()),
    /different details/,
  );
  for (const endDate of ["2000-01-01", "2030-05-02"])
    await assert.rejects(
      () =>
        assignmentAdmin(
          runtime,
          { ...event, id: randomUUID(), endDate },
          actor,
        ),
      /Check the event date/,
    );
  const ids = first.workspace.households.map((h) => h.id);
  const foreign = (
    await assignmentAdmin(
      runtime,
      { action: "workspace", campaignId: other.id },
      actor,
    )
  ).workspace.households[0].id;
  const assignment = {
    action: "assignment",
    id: randomUUID(),
    campaignId: campaign.id,
    eventId: event.id,
    name: "Volunteer A",
    kind: "building",
    householdIds: ids.slice(0, 2),
  };
  for (const invalid of [
    { ...assignment, householdIds: [foreign] },
    { ...assignment, eventId: randomUUID() },
    { ...assignment, householdIds: [ids[0], ids[2]] },
    { ...assignment, householdIds: [ids[0], ids[0]] },
  ])
    await assert.rejects(() => assignmentAdmin(runtime, invalid, actor));
  const [saved, retry] = await Promise.all([
    assignmentAdmin(runtime, assignment, actor),
    assignmentAdmin(runtime, assignment, actor),
  ]);
  assert.equal(saved.savedId, assignment.id);
  assert.deepEqual(saved, retry);
  assert.deepEqual(
    saved.workspace.assignments[0].householdIds,
    ids.slice(0, 2),
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { ...assignment, householdIds: [ids[1], ids[0]] },
        actor,
      ),
    /different details/,
  );
  // One new ID conflicts after its assignment row would otherwise have been inserted.
  const conflicting = { ...assignment, id: randomUUID() };
  await assert.rejects(
    () => assignmentAdmin(runtime, conflicting, actor),
    /already assigned/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.assignments WHERE id=$1",
        [conflicting.id],
      )
    ).rows[0].n,
    0,
  );
  const racing = await Promise.allSettled(
    [0, 1].map(() =>
      assignmentAdmin(
        runtime,
        { ...assignment, id: randomUUID(), householdIds: [ids[2]] },
        actor,
      ),
    ),
  );
  assert.equal(racing.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(racing.filter((r) => r.status === "rejected").length, 1);
  const anotherEvent = { ...event, id: randomUUID(), name: "Second event" };
  await assignmentAdmin(runtime, anotherEvent, actor);
  const scattered = {
    ...assignment,
    id: randomUUID(),
    eventId: anotherEvent.id,
    kind: "scattered",
    householdIds: [ids[2], ids[0]],
  };
  const ordered = await assignmentAdmin(runtime, scattered, actor);
  assert.deepEqual(
    ordered.workspace.assignments.find((a) => a.id === scattered.id)
      ?.householdIds,
    [ids[2], ids[0]],
  );
  await pool.query(
    "UPDATE outreach.households SET suppressed=true WHERE id=$1",
    [ids[1]],
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        {
          ...assignment,
          id: randomUUID(),
          eventId: anotherEvent.id,
          householdIds: [ids[1]],
        },
        actor,
      ),
    /unsuppressed doors/,
  );
  const restored = await assignmentAdmin(
    runtime,
    { action: "workspace", campaignId: campaign.id },
    actor,
  );
  assert.equal(restored.workspace.assignments.length, 3);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.credentials k JOIN outreach.assignments a ON a.id=k.assignment_id WHERE a.campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].n,
    0,
  );
  for (const sql of [
    "SELECT * FROM outreach.events",
    "SELECT * FROM outreach.memberships",
    "SELECT * FROM outreach.households",
    "SET ROLE jco_assignment_executor",
    "DELETE FROM outreach.events",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const signature of [
      "outreach.assignment_workspace(uuid)",
      "outreach.create_outreach_event(uuid,uuid,text,date,uuid)",
      "outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid)",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed",
            [role, signature],
          )
        ).rows[0].allowed,
        false,
      );
  }
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '1 day' WHERE id=$1",
    [anotherEvent.id],
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        {
          ...assignment,
          id: randomUUID(),
          eventId: anotherEvent.id,
          householdIds: [ids[0]],
        },
        actor,
      ),
    /active event/,
  );
});

test("hosted private links scope downloads and atomic operations; retries, revisions and lifecycle are safe", async () => {
  const runtime = postgresDatabase(reader);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateField(postgresDatabase(migrator));
    await migrateField(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const actor = randomUUID();
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Field loop", endDate: "2030-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Field practice",
      endDate: "2030-04-20",
    },
    actor,
  );
  const ids = event.workspace.households.map((h) => h.id),
    aid = randomUUID(),
    otherAid = randomUUID();
  for (const [id, householdIds] of [
    [aid, ids.slice(0, 2)],
    [otherAid, ids.slice(2)],
  ] as const)
    await assignmentAdmin(
      runtime,
      {
        action: "assignment",
        campaignId: campaign.id,
        eventId: event.savedId,
        id,
        name: "Practice volunteer",
        kind: "building",
        householdIds,
      },
      actor,
    );
  const issuedId = randomUUID();
  const issued = await hostedFieldAdmin(
    runtime,
    { action: "issue", assignmentId: aid, id: issuedId },
    actor,
  );
  assert.match(issued.token!, /^[A-Za-z0-9_-]{43}$/);
  const token = issued.token!;
  const retry = await hostedFieldAdmin(
    runtime,
    { action: "issue", assignmentId: aid, id: issuedId },
    actor,
  );
  assert.equal(retry.token, null);
  assert.equal(retry.snapshot.credentials.length, 1);
  const status = (code: number) => (e: unknown) =>
    e instanceof DomainError && e.status === code;
  await assert.rejects(
    () =>
      hostedFieldAdmin(
        runtime,
        { action: "issue", assignmentId: otherAid, id: issuedId },
        actor,
      ),
    status(409),
  );
  const assignment = await downloadHostedAssignment(runtime, token);
  assert.equal(assignment.households.length, 2);
  assert.equal(assignment.households[0].people.length, 2);
  assert.deepEqual(
    assignment,
    await downloadAssignment(postgresDatabase(pool), token),
  );
  assert.doesNotMatch(
    JSON.stringify(assignment),
    /VANID|token_hash|created_by|source_id|Score|Owner|Tier/,
  );
  assert.doesNotMatch(JSON.stringify(issued.snapshot), new RegExp(token));
  assert.equal(
    (
      await pool.query(
        "SELECT token_hash FROM outreach.credentials WHERE id=$1",
        [issuedId],
      )
    ).rows[0].token_hash,
    hashToken(token),
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, "invalid"),
    status(401),
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, "x".repeat(43)),
    status(401),
  );
  function visit(extra: Partial<VisitOperation> = {}): VisitOperation {
    return {
      id: randomUUID(),
      visitId: randomUUID(),
      assignmentId: aid,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      kind: "visit",
      householdId: ids[0],
      result: "resident",
      programs: ["freeze"],
      help: null,
      corrections: [],
      doNotContact: false,
      ...extra,
    };
  }
  const op = visit({
    help: {
      id: randomUUID(),
      personId: null,
      phone: "",
      consent: false,
      arrangement: "return",
    },
    corrections: [
      {
        id: randomUUID(),
        kind: "moved",
        personId: assignment.households[0].people[0].id,
      },
    ],
    doNotContact: true,
  });
  const receipts = await Promise.all([
    submitHostedOperation(runtime, token, op),
    submitHostedOperation(runtime, token, op),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  await assert.rejects(
    () => submitHostedOperation(runtime, token, { ...op, result: "no_answer" }),
    status(409),
  );
  const snapshot = () =>
    hostedFieldAdmin(runtime, { action: "status", assignmentId: aid }, actor);
  let state = (await snapshot()).snapshot;
  assert.deepEqual(state.counts, { attempts: 1, repeats: 0, conversations: 1 });
  assert.equal(state.helpRequests, 1);
  assert.equal(
    (await downloadHostedAssignment(runtime, token)).households[0].suppressed,
    true,
  );
  for (const invalid of [
    visit({ householdId: ids[2] }),
    visit({ assignmentId: otherAid }),
    visit({
      corrections: [
        { id: randomUUID(), kind: "moved", personId: randomUUID() },
      ],
    }),
  ])
    await assert.rejects(
      () => submitHostedOperation(runtime, token, invalid),
      status(403),
    );
  await assert.rejects(
    () =>
      submitHostedOperation(
        runtime,
        token,
        visit({
          help: {
            id: randomUUID(),
            personId: null,
            phone: "555",
            consent: false,
            arrangement: "return",
          },
        }),
      ),
    status(422),
  );
  await assert.rejects(
    () =>
      submitHostedOperation(runtime, token, {
        ...visit(),
        extra: "not permitted",
      }),
    status(422),
  );
  await assert.rejects(
    () =>
      reader.query("SELECT outreach.submit_field_operation($1,$2)", [
        hashToken(token),
        JSON.stringify({ ...visit(), extra: "not permitted" }),
      ]),
    (e) => (e as { code: string }).code === "JF422",
  );
  // Force a late associated-row failure after operation+visit insertion.
  const broken = visit({ help: { ...op.help!, id: op.help!.id } });
  await assert.rejects(
    () => submitHostedOperation(runtime, token, broken),
    status(409),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM outreach.operations WHERE id=$1",
        [broken.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM outreach.visits WHERE id=$1",
        [broken.visitId],
      )
    ).rows[0].n,
    0,
  );
  await pool.query("UPDATE outreach.help_requests SET status=$1 WHERE id=$2", [
    "In progress",
    op.help!.id,
  ]);
  const revision = {
    id: randomUUID(),
    assignmentId: aid,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    kind: "revision",
    visitId: op.visitId,
    householdId: ids[0],
    originalOperationId: op.id,
    previousOperationId: op.id,
    result: "no_answer",
  };
  await submitHostedOperation(runtime, token, revision);
  await submitHostedOperation(runtime, token, revision);
  assert.equal((await snapshot()).snapshot.counts.conversations, 0);
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM outreach.help_requests WHERE id=$1",
        [op.help!.id],
      )
    ).rows[0].status,
    "In progress",
  );
  await assert.rejects(
    () =>
      submitHostedOperation(runtime, token, { ...revision, id: randomUUID() }),
    status(409),
  );
  await assert.rejects(
    () =>
      submitHostedOperation(runtime, token, {
        ...revision,
        id: randomUUID(),
        visitId: randomUUID(),
      }),
    status(424),
  );
  const secondId = randomUUID();
  const concurrentIssuance = await Promise.all(
    [0, 1].map(() =>
      hostedFieldAdmin(
        runtime,
        { action: "issue", assignmentId: aid, id: secondId },
        actor,
      ),
    ),
  );
  assert.equal(concurrentIssuance.filter((result) => !!result.token).length, 1);
  assert.equal((await snapshot()).snapshot.credentials.length, 2);
  const second = concurrentIssuance.find((result) => !!result.token)!;
  await submitHostedOperation(runtime, second.token!, visit());
  assert.deepEqual((await snapshot()).snapshot.counts, {
    attempts: 1,
    repeats: 1,
    conversations: 1,
  });
  const building = {
    id: randomUUID(),
    assignmentId: aid,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    kind: "building",
    buildingId: assignment.households[0].buildingId,
    reason: "locked",
  };
  await submitHostedOperation(runtime, token, building);
  await submitHostedOperation(runtime, token, building);
  state = (await snapshot()).snapshot;
  assert.equal(state.buildingFailures, 1);
  assert.equal(state.counts.attempts, 1);
  await assert.rejects(
    () =>
      submitHostedOperation(runtime, token, {
        ...building,
        id: randomUUID(),
        buildingId: randomUUID(),
      }),
    status(403),
  );
  // A superseded member disappears from downloads but genuine pending work survives.
  await pool.query(
    "UPDATE outreach.memberships SET state=$1 WHERE assignment_id=$2 AND household_id=$3",
    ["superseded", aid, ids[1]],
  );
  assert.equal(
    (await downloadHostedAssignment(runtime, token)).households.length,
    1,
  );
  await submitHostedOperation(runtime, token, visit({ householdId: ids[1] }));
  await hostedFieldAdmin(
    runtime,
    { action: "revoke", assignmentId: aid, id: issuedId, confirmed: true },
    actor,
  );
  await hostedFieldAdmin(
    runtime,
    { action: "revoke", assignmentId: aid, id: issuedId, confirmed: true },
    actor,
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, token),
    status(403),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT revoked_by FROM outreach.credentials WHERE id=$1",
        [issuedId],
      )
    ).rows[0].revoked_by,
    actor,
  );
  await assert.rejects(
    () => submitHostedOperation(runtime, token, op),
    status(403),
  );
  await downloadHostedAssignment(runtime, second.token!);
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '1 hour' WHERE id=$1",
    [event.savedId],
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, second.token!),
    status(403),
  );
  await submitHostedOperation(
    runtime,
    second.token!,
    visit({ createdAt: new Date(Date.now() - 2 * 3600000).toISOString() }),
  );
  await assert.rejects(
    () => submitHostedOperation(runtime, second.token!, visit()),
    status(422),
  );
  await assert.rejects(
    () =>
      hostedFieldAdmin(
        runtime,
        { action: "issue", assignmentId: aid, id: randomUUID() },
        actor,
      ),
    status(422),
  );
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '74 hours' WHERE id=$1",
    [event.savedId],
  );
  await assert.rejects(
    () => submitHostedOperation(runtime, second.token!, op),
    status(410),
  );
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()+interval '1 day' WHERE id=$1",
    [event.savedId],
  );
  // Expiry must deny access even before a deletion job exists.
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, second.token!),
    status(410),
  );
  await assert.rejects(
    () => submitHostedOperation(runtime, second.token!, op),
    status(410),
  );
  await assert.rejects(() => snapshot(), status(404));
  for (const sql of [
    "SELECT * FROM outreach.credentials",
    "SELECT * FROM outreach.operations",
    "SET ROLE jco_field_executor",
    "SET ROLE jco_field_admin_executor",
    "DELETE FROM outreach.visits",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const signature of [
    "outreach.field_access(text,boolean)",
    "outreach.field_keys(jsonb,text[])",
  ])
    assert.equal(
      (
        await reader.query(
          "SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed",
          [signature],
        )
      ).rows[0].allowed,
      false,
    );
  for (const role of ["anon", "authenticated", "service_role"])
    for (const signature of [
      "outreach.download_field_assignment(text)",
      "outreach.submit_field_operation(text,jsonb)",
      "outreach.field_admin_snapshot(uuid)",
      "outreach.issue_field_credential(uuid,uuid,text,uuid)",
      "outreach.revoke_field_credential(uuid,uuid,uuid)",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') allowed",
            [role, signature],
          )
        ).rows[0].allowed,
        false,
      );
});

test("link labels persist atomically, preserve legacy credentials and reject changed retry labels", async () => {
  const runtime = postgresDatabase(reader);
  const actor = randomUUID();
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Link label practice", endDate: "2030-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Label practice",
      endDate: "2030-04-20",
    },
    actor,
  );
  const aid = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: aid,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Practice team",
      kind: "building",
      householdIds: [event.workspace.households[0].id],
    },
    actor,
  );
  const legacyId = randomUUID();
  const legacy = await hostedFieldAdmin(
    runtime,
    { action: "issue", id: legacyId, assignmentId: aid },
    actor,
  );
  const before = await downloadHostedAssignment(runtime, legacy.token!);
  const op: VisitOperation = {
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: aid,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    kind: "visit",
    householdId: before.households[0].id,
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  };
  const receipt = await submitHostedOperation(runtime, legacy.token!, op);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateLinkLabels(postgresDatabase(migrator));
    await migrateLinkLabels(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  assert.deepEqual(
    await downloadHostedAssignment(runtime, legacy.token!),
    before,
  );
  assert.deepEqual(
    await submitHostedOperation(runtime, legacy.token!, op),
    receipt,
  );
  const initial = await hostedFieldAdmin(
    runtime,
    { action: "status", assignmentId: aid },
    actor,
  );
  assert.equal(initial.snapshot.labelsReady, true);
  assert.equal(
    initial.snapshot.credentials.find((c) => c.id === legacyId)?.label,
    null,
  );
  assert.equal(initial.snapshot.counts.attempts, 1);
  const request = {
    action: "issue",
    id: randomUUID(),
    assignmentId: aid,
    label: "Practice Alex — Saturday",
  };
  const pair = await Promise.all([
    hostedFieldAdmin(runtime, request, actor),
    hostedFieldAdmin(runtime, request, actor),
  ]);
  assert.equal(pair.filter((r) => r.token !== null).length, 1);
  const issued = pair.find((r) => r.token !== null)!;
  assert.equal(
    issued.snapshot.credentials.find((c) => c.id === request.id)?.label,
    request.label,
  );
  assert.equal(issued.snapshot.credentials.length, 2);
  const restored = await hostedFieldAdmin(
    runtime,
    { action: "status", assignmentId: aid },
    actor,
  );
  assert.equal(
    restored.snapshot.credentials.find((c) => c.id === request.id)?.label,
    request.label,
  );
  assert.equal((await hostedFieldAdmin(runtime, request, actor)).token, null);
  const conflict = (e: unknown) => e instanceof DomainError && e.status === 409;
  await assert.rejects(
    () =>
      hostedFieldAdmin(
        runtime,
        { ...request, label: "Different volunteer" },
        actor,
      ),
    conflict,
  );
  await assert.rejects(
    () => hostedFieldAdmin(runtime, request, randomUUID()),
    conflict,
  );
  assert.doesNotMatch(
    JSON.stringify(await downloadHostedAssignment(runtime, issued.token!)),
    /Practice Alex|label|labelsReady/,
  );
  for (const label of [null, "", " ", "x".repeat(101), "bad\nname"]) {
    const id = randomUUID();
    await assert.rejects(() =>
      reader.query("SELECT outreach.issue_field_credential($1,$2,$3,$4,$5)", [
        id,
        aid,
        hashToken(randomUUID()),
        actor,
        label,
      ]),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM outreach.credentials WHERE id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
  }
  await assert.rejects(() =>
    reader.query("UPDATE outreach.credentials SET label='forged' WHERE id=$1", [
      request.id,
    ]),
  );
  await assert.rejects(() =>
    reader.query("SELECT label FROM outreach.credentials"),
  );
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await pool.query(
          "SELECT has_function_privilege($1,'outreach.issue_field_credential(uuid,uuid,text,uuid,text)','EXECUTE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  const revoked = await hostedFieldAdmin(
    runtime,
    { action: "revoke", id: request.id, assignmentId: aid, confirmed: true },
    actor,
  );
  assert.equal(
    revoked.snapshot.credentials.find((c) => c.id === request.id)?.label,
    request.label,
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, issued.token!),
    (e) => e instanceof DomainError && e.status === 403,
  );
  assert.deepEqual(
    await downloadHostedAssignment(runtime, legacy.token!),
    before,
  );
});

test("help queue preserves visits, scopes reads, audits atomic versioned updates and safely retries", async () => {
  const runtime = postgresDatabase(reader),
    actor = randomUUID();
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Help queue practice", endDate: "2030-05-01" },
    actor,
  );
  const other = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Other help campaign", endDate: "2030-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Help practice",
      endDate: "2030-04-20",
    },
    actor,
  );
  const aid = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: aid,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Practice helper",
      kind: "building",
      householdIds: [event.workspace.households[0].id],
    },
    actor,
  );
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId: aid,
      label: "Help test",
    },
    actor,
  );
  const before = await downloadHostedAssignment(runtime, issued.token!);
  const makeVisit = (phone: string): VisitOperation => ({
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: aid,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    kind: "visit",
    householdId: before.households[0].id,
    result: "resident",
    programs: [],
    help: {
      id: randomUUID(),
      personId: phone ? before.households[0].people[0].id : null,
      phone,
      consent: !!phone,
      arrangement: phone ? "unspecified" : "return",
    },
    corrections: [],
    doNotContact: false,
  });
  const op = makeVisit(""),
    second = makeVisit("201-555-0100");
  const visitReceipt = await submitHostedOperation(runtime, issued.token!, op);
  await submitHostedOperation(runtime, issued.token!, second);
  const beforeQueue = await helpAdmin(
    runtime,
    { action: "list", campaignId: campaign.id },
    actor,
  );
  assert.equal(beforeQueue.queue.ready, false);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateHelpQueue(postgresDatabase(migrator));
    await migrateHelpQueue(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const list = () =>
    helpAdmin(runtime, { action: "list", campaignId: campaign.id }, actor);
  let queue = (await list()).queue;
  assert.equal(queue.ready, true);
  assert.equal(queue.requests.length, 2);
  const first = queue.requests.find((r) => r.id === op.help!.id)!;
  assert.equal(first.phone, "");
  assert.equal(first.consent, false);
  assert.equal(first.requester, null);
  assert.equal(first.arrangement, "return");
  assert.equal(first.status, "New");
  assert.equal(first.version, 0);
  const withPhone = queue.requests.find((r) => r.id === second.help!.id)!;
  assert.equal(withPhone.phone, "201-555-0100");
  assert.equal(withPhone.consent, true);
  assert.ok(withPhone.requester);
  assert.equal(first.visitId, op.visitId);
  assert.equal(first.assignmentName, "Practice helper");
  assert.equal(
    (await helpAdmin(runtime, { action: "list", campaignId: other.id }, actor))
      .queue.requests.length,
    0,
  );
  const update = {
    action: "update",
    id: randomUUID(),
    campaignId: campaign.id,
    requestId: op.help!.id,
    expectedVersion: 0,
    status: "In progress",
  } as const;
  const denied = (status: number) => (e: unknown) =>
    e instanceof DomainError && e.status === status;
  await assert.rejects(
    () => helpAdmin(runtime, { ...update, campaignId: other.id }, actor),
    denied(404),
  );
  await assert.rejects(
    () => helpAdmin(runtime, { ...update, status: "Resolved" }, actor),
    denied(409),
  );
  const results = await Promise.all([
    helpAdmin(runtime, update, actor),
    helpAdmin(runtime, update, actor),
  ]);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.equal(results[0].receipt?.version, 1);
  await assert.rejects(
    () => helpAdmin(runtime, { ...update, status: "Resolved" }, actor),
    denied(409),
  );
  await assert.rejects(
    () => helpAdmin(runtime, update, randomUUID()),
    denied(409),
  );
  await assert.rejects(
    () => helpAdmin(runtime, { ...update, id: randomUUID() }, actor),
    denied(409),
  );
  const finish = {
    ...update,
    id: randomUUID(),
    expectedVersion: 1,
    status: "Resolved",
  };
  const race = await Promise.allSettled([
    helpAdmin(runtime, finish, actor),
    helpAdmin(runtime, { ...finish, id: randomUUID() }, randomUUID()),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.filter((r) => r.status === "rejected").length, 1);
  const lateRetry = await helpAdmin(runtime, update, actor);
  assert.equal(lateRetry.receipt?.status, "In progress");
  assert.equal(
    lateRetry.queue.requests.find((r) => r.id === op.help!.id)!.status,
    "Resolved",
  );
  assert.equal(
    lateRetry.queue.requests.find((r) => r.id === op.help!.id)!.version,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.help_status_changes WHERE request_id=$1",
        [op.help!.id],
      )
    ).rows[0].count,
    2,
  );
  const history = await pool.query(
    "SELECT previous_status,status FROM outreach.help_status_changes WHERE request_id=$1 ORDER BY expected_version",
    [op.help!.id],
  );
  assert.deepEqual(history.rows, [
    { previous_status: "New", status: "In progress" },
    { previous_status: "In progress", status: "Resolved" },
  ]);
  assert.deepEqual(
    await submitHostedOperation(runtime, issued.token!, op),
    visitReceipt,
  );
  await submitHostedOperation(runtime, issued.token!, {
    kind: "revision",
    schemaVersion: 1,
    id: randomUUID(),
    assignmentId: aid,
    visitId: op.visitId,
    householdId: op.householdId,
    createdAt: new Date().toISOString(),
    originalOperationId: op.id,
    previousOperationId: op.id,
    result: "other",
  });
  assert.equal(
    (await list()).queue.requests.find((r) => r.id === op.help!.id)!.status,
    "Resolved",
  );
  assert.deepEqual(
    await downloadHostedAssignment(runtime, issued.token!),
    before,
  );

  // An actual late database failure must roll back both status and audit receipt.
  await pool.query(
    "CREATE FUNCTION outreach.fail_help_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_help_history BEFORE INSERT ON outreach.help_status_changes FOR EACH ROW EXECUTE FUNCTION outreach.fail_help_history()",
  );
  const broken = { ...update, id: randomUUID(), requestId: second.help!.id };
  await assert.rejects(() => helpAdmin(runtime, broken, actor));
  await pool.query(
    "DROP TRIGGER fail_help_history ON outreach.help_status_changes; DROP FUNCTION outreach.fail_help_history()",
  );
  assert.equal(
    (await list()).queue.requests.find((r) => r.id === second.help!.id)!.status,
    "New",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.help_status_changes WHERE id=$1",
        [broken.id],
      )
    ).rows[0].count,
    0,
  );
  await helpAdmin(runtime, broken, actor);
  for (const sql of [
    "SELECT * FROM outreach.help_requests",
    "SELECT * FROM outreach.help_status_changes",
    "UPDATE outreach.help_requests SET status='Resolved'",
    "SET ROLE jco_help_executor",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"])
    for (const signature of [
      "outreach.help_queue(uuid)",
      "outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid)",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') allowed",
            [role, signature],
          )
        ).rows[0].allowed,
        false,
      );
  for (const invalid of [null, "New", "invalid"])
    await assert.rejects(() =>
      reader.query("SELECT outreach.update_help_status($1,$2,$3,$4,$5,$6)", [
        randomUUID(),
        campaign.id,
        second.help!.id,
        1,
        invalid,
        actor,
      ]),
    );
  await pool.query(
    "UPDATE outreach.households SET suppressed=true WHERE id=$1",
    [op.householdId],
  );
  assert.equal((await list()).queue.requests[0].suppressed, true);
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  await assert.rejects(list, denied(404));
  await assert.rejects(() => helpAdmin(runtime, update, actor), denied(404));
  await pool.query("DELETE FROM outreach.campaigns WHERE id=$1", [campaign.id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.help_status_changes WHERE campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].count,
    0,
  );
});

test("correction queue preserves visits, scopes reads, audits atomic versioned updates and safely retries", async () => {
  const runtime = postgresDatabase(reader),
    actor = randomUUID();
  const campaign = await createHostedCampaign(
    runtime,
    {
      id: randomUUID(),
      name: "Correction queue practice",
      endDate: "2030-05-01",
    },
    actor,
  );
  const other = await createHostedCampaign(
    runtime,
    {
      id: randomUUID(),
      name: "Other correction campaign",
      endDate: "2030-05-01",
    },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Correction practice",
      endDate: "2030-04-20",
    },
    actor,
  );
  const aid = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: aid,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Practice reviewer",
      kind: "building",
      householdIds: [event.workspace.households[0].id],
    },
    actor,
  );
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId: aid,
      label: "Correction test",
    },
    actor,
  );
  const before = await downloadHostedAssignment(runtime, issued.token!);
  const makeVisit = (
    kind: "moved" | "rents" | "deceased" | "address",
  ): VisitOperation => ({
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: aid,
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    kind: "visit",
    householdId: before.households[0].id,
    result: "resident",
    programs: [],
    help: null,
    corrections: [
      {
        id: randomUUID(),
        kind,
        personId:
          kind === "moved" || kind === "deceased"
            ? before.households[0].people[0].id
            : null,
      },
    ],
    doNotContact: false,
  });
  const op = makeVisit("moved"),
    second = makeVisit("rents");
  assert.ok(before.households[0].people.length >= 2);
  const visitReceipt = await submitHostedOperation(runtime, issued.token!, op);
  await submitHostedOperation(runtime, issued.token!, second);
  const beforeQueue = await correctionAdmin(
    runtime,
    { action: "list", campaignId: campaign.id },
    actor,
  );
  assert.equal(beforeQueue.queue.ready, false);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateCorrectionQueue(postgresDatabase(migrator));
    await migrateCorrectionQueue(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const list = () =>
    correctionAdmin(
      runtime,
      { action: "list", campaignId: campaign.id },
      actor,
    );
  let queue = (await list()).queue;
  assert.equal(queue.ready, true);
  assert.equal(queue.reports.length, 2);
  const first = queue.reports.find((r) => r.id === op.corrections[0].id)!;
  assert.equal(first.kind, "moved");
  assert.equal(
    first.person,
    [
      before.households[0].people[0].firstName,
      before.households[0].people[0].lastName,
    ].join(" "),
  );
  assert.equal(first.status, "Open");
  assert.equal(first.version, 0);
  const householdReport = queue.reports.find(
    (r) => r.id === second.corrections[0].id,
  )!;
  assert.equal(householdReport.kind, "rents");
  assert.equal(householdReport.person, null);
  assert.equal("phone" in first, false);
  assert.equal(first.visitId, op.visitId);
  assert.equal(first.assignmentName, "Practice reviewer");
  assert.equal(
    (
      await correctionAdmin(
        runtime,
        { action: "list", campaignId: other.id },
        actor,
      )
    ).queue.reports.length,
    0,
  );
  const update = {
    action: "update",
    id: randomUUID(),
    campaignId: campaign.id,
    reportId: op.corrections[0].id,
    expectedVersion: 0,
    status: "Reviewed",
  } as const;
  const denied = (status: number) => (e: unknown) =>
    e instanceof DomainError && e.status === status;
  await assert.rejects(
    () => correctionAdmin(runtime, { ...update, campaignId: other.id }, actor),
    denied(404),
  );
  await assert.rejects(
    () => correctionAdmin(runtime, { ...update, status: "Open" }, actor),
    denied(409),
  );
  const results = await Promise.all([
    correctionAdmin(runtime, update, actor),
    correctionAdmin(runtime, update, actor),
  ]);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  assert.equal(results[0].receipt?.version, 1);
  await assert.rejects(
    () => correctionAdmin(runtime, { ...update, status: "Open" }, actor),
    denied(409),
  );
  await assert.rejects(
    () => correctionAdmin(runtime, update, randomUUID()),
    denied(409),
  );
  await assert.rejects(
    () => correctionAdmin(runtime, { ...update, id: randomUUID() }, actor),
    denied(409),
  );
  const finish = {
    ...update,
    id: randomUUID(),
    expectedVersion: 1,
    status: "Open",
  };
  const race = await Promise.allSettled([
    correctionAdmin(runtime, finish, actor),
    correctionAdmin(runtime, { ...finish, id: randomUUID() }, randomUUID()),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.filter((r) => r.status === "rejected").length, 1);
  const lateRetry = await correctionAdmin(runtime, update, actor);
  assert.equal(lateRetry.receipt?.status, "Reviewed");
  assert.equal(
    lateRetry.queue.reports.find((r) => r.id === op.corrections[0].id)!.status,
    "Open",
  );
  assert.equal(
    lateRetry.queue.reports.find((r) => r.id === op.corrections[0].id)!.version,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.correction_status_changes WHERE report_id=$1",
        [op.corrections[0].id],
      )
    ).rows[0].count,
    2,
  );
  const history = await pool.query(
    "SELECT previous_status,status FROM outreach.correction_status_changes WHERE report_id=$1 ORDER BY expected_version",
    [op.corrections[0].id],
  );
  assert.deepEqual(history.rows, [
    { previous_status: "Open", status: "Reviewed" },
    { previous_status: "Reviewed", status: "Open" },
  ]);
  assert.deepEqual(
    await submitHostedOperation(runtime, issued.token!, op),
    visitReceipt,
  );
  await submitHostedOperation(runtime, issued.token!, {
    kind: "revision",
    schemaVersion: 1,
    id: randomUUID(),
    assignmentId: aid,
    visitId: op.visitId,
    householdId: op.householdId,
    createdAt: new Date().toISOString(),
    originalOperationId: op.id,
    previousOperationId: op.id,
    result: "other",
  });
  assert.equal(
    (await list()).queue.reports.find((r) => r.id === op.corrections[0].id)!
      .status,
    "Open",
  );
  assert.deepEqual(
    await downloadHostedAssignment(runtime, issued.token!),
    before,
  );

  for (const kind of ["deceased", "address"] as const) {
    await submitHostedOperation(runtime, issued.token!, makeVisit(kind));
  }
  assert.deepEqual(
    new Set((await list()).queue.reports.map((r) => r.kind)),
    new Set(["moved", "rents", "deceased", "address"]),
  );
  assert.deepEqual(
    await downloadHostedAssignment(runtime, issued.token!),
    before,
  );
  const reported = await pool.query(
    "SELECT kind,person_id FROM outreach.corrections WHERE id=$1",
    [op.corrections[0].id],
  );
  assert.deepEqual(reported.rows, [
    { kind: "moved", person_id: before.households[0].people[0].id },
  ]);

  // An actual late database failure must roll back both status and audit receipt.
  await pool.query(
    "CREATE FUNCTION outreach.fail_correction_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER fail_correction_history BEFORE INSERT ON outreach.correction_status_changes FOR EACH ROW EXECUTE FUNCTION outreach.fail_correction_history()",
  );
  const broken = {
    ...update,
    id: randomUUID(),
    reportId: second.corrections[0].id,
  };
  await assert.rejects(() => correctionAdmin(runtime, broken, actor));
  await pool.query(
    "DROP TRIGGER fail_correction_history ON outreach.correction_status_changes; DROP FUNCTION outreach.fail_correction_history()",
  );
  assert.equal(
    (await list()).queue.reports.find((r) => r.id === second.corrections[0].id)!
      .status,
    "Open",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.correction_status_changes WHERE id=$1",
        [broken.id],
      )
    ).rows[0].count,
    0,
  );
  await correctionAdmin(runtime, broken, actor);
  for (const sql of [
    "SELECT * FROM outreach.corrections",
    "SELECT * FROM outreach.correction_status_changes",
    "UPDATE outreach.corrections SET status='Reviewed'",
    "SET ROLE jco_correction_executor",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"])
    for (const signature of [
      "outreach.correction_queue(uuid)",
      "outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid)",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') allowed",
            [role, signature],
          )
        ).rows[0].allowed,
        false,
      );
  for (const invalid of [null, "Verified", "invalid"])
    await assert.rejects(() =>
      reader.query(
        "SELECT outreach.update_correction_status($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          campaign.id,
          second.corrections[0].id,
          1,
          invalid,
          actor,
        ],
      ),
    );
  await pool.query(
    "UPDATE outreach.households SET suppressed=true WHERE id=$1",
    [op.householdId],
  );
  assert.equal((await list()).queue.reports[0].suppressed, true);
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  await assert.rejects(list, denied(404));
  await assert.rejects(
    () => correctionAdmin(runtime, update, actor),
    denied(404),
  );
  await pool.query("DELETE FROM outreach.campaigns WHERE id=$1", [campaign.id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM outreach.correction_status_changes WHERE campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].count,
    0,
  );
});

test("reassignment is atomic, scoped and retry-safe; superseded links retain offline uploads but not fresh door downloads", async () => {
  const runtime = postgresDatabase(reader),
    actor = randomUUID();
  const denied = (status: number) => (e: unknown) =>
    e instanceof DomainError && e.status === status;
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Reassignment practice", endDate: "2030-05-01" },
    actor,
  );
  const other = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Other move campaign", endDate: "2030-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Move practice",
      endDate: "2030-04-20",
    },
    actor,
  );
  const doors = event.workspace.households.map((h) => h.id);
  const source = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: source,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Original volunteer",
      kind: "scattered",
      householdIds: doors,
    },
    actor,
  );
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId: source,
      label: "Original private link",
    },
    actor,
  );
  const before = await downloadHostedAssignment(runtime, issued.token!);
  const makeVisit = (
    assignmentId = source,
    householdId = doors[0],
  ): VisitOperation => ({
    id: randomUUID(),
    visitId: randomUUID(),
    schemaVersion: 1,
    assignmentId,
    householdId,
    kind: "visit",
    createdAt: new Date().toISOString(),
    result: "resident",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  });
  const existing = makeVisit(),
    offline = makeVisit();
  await submitHostedOperation(runtime, issued.token!, existing);
  assert.equal(
    (
      await assignmentAdmin(
        runtime,
        { action: "workspace", campaignId: campaign.id },
        actor,
      )
    ).workspace.reassignmentReady,
    undefined,
  );
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateReassignment(postgresDatabase(migrator));
    await migrateReassignment(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  const move = {
    action: "reassign",
    id: randomUUID(),
    campaignId: campaign.id,
    sourceId: source,
    name: "Replacement volunteer",
    householdIds: [doors[0]],
    confirmed: true,
  } as const;
  const results = await Promise.all([
    assignmentAdmin(runtime, move, actor),
    assignmentAdmin(runtime, move, actor),
  ]);
  assert.equal(results[0].savedId, move.id);
  assert.equal(results[1].savedId, move.id);
  assert.equal(results[0].workspace.reassignmentReady, true);
  const old = results[0].workspace.assignments.find((a) => a.id === source)!;
  const replacement = results[0].workspace.assignments.find(
    (a) => a.id === move.id,
  )!;
  assert.deepEqual(old.householdIds, doors.slice(1));
  assert.deepEqual(old.supersededHouseholdIds, [doors[0]]);
  assert.deepEqual(replacement.householdIds, [doors[0]]);
  assert.equal(replacement.eventId, event.savedId);
  assert.equal(replacement.kind, "scattered");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.reassignments WHERE id=$1",
        [move.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.credentials WHERE assignment_id=$1",
        [move.id],
      )
    ).rows[0].n,
    0,
  );
  for (const changed of [
    { ...move, name: "Different" },
    { ...move, householdIds: [doors[1]] },
    { ...move, id: randomUUID() },
  ])
    await assert.rejects(
      () => assignmentAdmin(runtime, changed, actor),
      denied(409),
    );
  await assert.rejects(
    () => assignmentAdmin(runtime, move, randomUUID()),
    denied(409),
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { ...move, id: randomUUID(), campaignId: other.id },
        actor,
      ),
    denied(404),
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { ...move, id: randomUUID(), householdIds: [doors[1], randomUUID()] },
        actor,
      ),
    denied(409),
  );
  const refreshed = await downloadHostedAssignment(runtime, issued.token!);
  assert.deepEqual(
    refreshed.households,
    before.households.filter((h) => h.id !== doors[0]),
  );
  assert.deepEqual(refreshed.supersededHouseholdIds, [doors[0]]);
  assert.ok(!refreshed.households.some((h) => h.id === doors[0]));
  const receipt = await submitHostedOperation(runtime, issued.token!, offline);
  assert.deepEqual(
    await submitHostedOperation(runtime, issued.token!, offline),
    receipt,
  );
  let snap = (
    await hostedFieldAdmin(
      runtime,
      { action: "status", assignmentId: source },
      actor,
    )
  ).snapshot;
  assert.equal(snap.visits.length, 2);
  assert.ok(snap.visits.every((v) => v.superseded));
  assert.equal(snap.credentials[0].label, "Original private link");
  assert.equal(snap.credentials[0].revoked, false);
  const newLink = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId: move.id,
      label: "New volunteer",
    },
    actor,
  );
  assert.deepEqual(
    (await downloadHostedAssignment(runtime, newLink.token!)).households,
    before.households.filter((h) => h.id === doors[0]),
  );
  const independent = makeVisit(move.id);
  await submitHostedOperation(runtime, newLink.token!, independent);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.visits WHERE household_id=$1",
        [doors[0]],
      )
    ).rows[0].n,
    3,
  );
  await submitHostedOperation(runtime, issued.token!, {
    id: randomUUID(),
    kind: "revision",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    assignmentId: source,
    visitId: offline.visitId,
    householdId: doors[0],
    originalOperationId: offline.id,
    previousOperationId: offline.id,
    result: "other",
  });
  snap = (
    await hostedFieldAdmin(
      runtime,
      { action: "status", assignmentId: source },
      actor,
    )
  ).snapshot;
  assert.equal(snap.visits.length, 2);
  // A real audit failure after creating the target must roll back all membership/assignment writes.
  const next = {
    ...move,
    id: randomUUID(),
    householdIds: [doors[1]],
    name: "Retry volunteer",
  };
  await pool.query(
    "CREATE FUNCTION outreach.fail_reassignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late failure'; END $$; CREATE TRIGGER fail_reassignment BEFORE INSERT ON outreach.reassignments FOR EACH ROW EXECUTE FUNCTION outreach.fail_reassignment()",
  );
  await assert.rejects(() => assignmentAdmin(runtime, next, actor));
  await pool.query(
    "DROP TRIGGER fail_reassignment ON outreach.reassignments; DROP FUNCTION outreach.fail_reassignment()",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.assignments WHERE id=$1",
        [next.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM outreach.memberships WHERE assignment_id=$1 AND household_id=$2",
        [source, doors[1]],
      )
    ).rows[0].state,
    "active",
  );
  const race = await Promise.allSettled([
    assignmentAdmin(runtime, next, actor),
    assignmentAdmin(runtime, { ...next, id: randomUUID() }, randomUUID()),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(race.filter((r) => r.status === "rejected").length, 1);
  await pool.query(
    "UPDATE outreach.households SET suppressed=true WHERE id=$1",
    [doors[2]],
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { ...move, id: randomUUID(), householdIds: [doors[2]] },
        actor,
      ),
    denied(409),
  );
  await pool.query(
    "UPDATE outreach.households SET suppressed=false WHERE id=$1",
    [doors[2]],
  );
  const last = await assignmentAdmin(
    runtime,
    { ...move, id: randomUUID(), householdIds: [doors[2]] },
    actor,
  );
  assert.deepEqual(
    last.workspace.assignments.find((a) => a.id === source)!.householdIds,
    [],
  );
  assert.equal(
    (await downloadHostedAssignment(runtime, issued.token!)).households.length,
    0,
  );
  assert.equal(
    (await downloadHostedAssignment(runtime, issued.token!))
      .supersededHouseholdIds!.length,
    3,
  );
  const delayed = makeVisit(source, doors[2]);
  await submitHostedOperation(runtime, issued.token!, delayed);
  const lateRetry = await assignmentAdmin(runtime, move, actor);
  assert.deepEqual(
    lateRetry.workspace.assignments.find((a) => a.id === source)!.householdIds,
    [],
  );
  // Ended events cannot start a new handoff.
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '1 hour' WHERE id=$1",
    [event.savedId],
  );
  await assert.rejects(
    () =>
      assignmentAdmin(
        runtime,
        { ...move, id: randomUUID(), sourceId: move.id },
        actor,
      ),
    denied(400),
  );
  await assert.rejects(
    () => downloadHostedAssignment(runtime, issued.token!),
    denied(403),
  );
  await assert.rejects(
    () =>
      submitHostedOperation(
        runtime,
        issued.token!,
        makeVisit(source, doors[2]),
      ),
    denied(422),
  );
  const latePending = {
    ...makeVisit(source, doors[2]),
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  };
  await submitHostedOperation(runtime, issued.token!, latePending);
  await hostedFieldAdmin(
    runtime,
    {
      action: "revoke",
      assignmentId: source,
      id: issued.credentialId!,
      confirmed: true,
    },
    actor,
  );
  await assert.rejects(
    () => submitHostedOperation(runtime, issued.token!, makeVisit()),
    denied(403),
  );
  for (const sql of [
    "SELECT * FROM outreach.reassignments",
    "UPDATE outreach.memberships SET state='superseded'",
    "SET ROLE jco_assignment_executor",
  ])
    await assert.rejects(() => reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(
      (
        await pool.query(
          "SELECT has_function_privilege($1,'outreach.reassign_households(uuid,uuid,uuid,text,uuid[],uuid)','EXECUTE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  await assert.rejects(
    () => assignmentAdmin(runtime, move, actor),
    denied(404),
  );
  await pool.query("DELETE FROM outreach.campaigns WHERE id=$1", [campaign.id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.reassignments WHERE campaign_id=$1",
        [campaign.id],
      )
    ).rows[0].n,
    0,
  );
});

test("completion migration preserves data, narrowly authorizes reports and derives completion from actual receipts", async () => {
  const runtime = postgresDatabase(reader),
    actor = randomUUID();
  const denied = (status: number) => (error: unknown) =>
    error instanceof DomainError && error.status === status;
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Completion practice", endDate: "2030-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Completion walk",
      endDate: "2030-04-20",
    },
    actor,
  );
  const assignmentId = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: assignmentId,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Finishing volunteer",
      kind: "scattered",
      householdIds: event.workspace.households.map((h) => h.id),
    },
    actor,
  );
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId,
      label: "Completion link",
    },
    actor,
  );
  const token = issued.token!;
  assert.equal(
    (await downloadHostedAssignment(runtime, token)).completionReady,
    undefined,
  );
  assert.equal(issued.snapshot.completion, undefined);
  const visit: VisitOperation = {
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId,
    householdId: event.workspace.households[0].id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: "visit",
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  };
  await submitHostedOperation(runtime, token, visit);
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateCompletion(postgresDatabase(migrator));
    await migrateCompletion(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  assert.equal(
    (await downloadHostedAssignment(runtime, token)).completionReady,
    true,
  );
  const status = async () =>
    (await hostedFieldAdmin(runtime, { action: "status", assignmentId }, actor))
      .snapshot;
  assert.equal((await status()).visits.length, 1);
  assert.deepEqual((await status()).completion!.devices, []);
  const pending = { ...visit, id: randomUUID(), visitId: randomUUID() };
  const report: CompletionReport = {
    id: randomUUID(),
    assignmentId,
    deviceId: randomUUID(),
    version: 1,
    state: "finished",
    operationIds: [visit.id, pending.id],
    pendingIds: [pending.id],
    createdAt: new Date().toISOString(),
  };
  const receipts = await Promise.all([
    submitHostedCompletion(runtime, token, report),
    submitHostedCompletion(runtime, token, report),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  let snapshot = await status();
  assert.equal(snapshot.visits.length, 1);
  assert.equal(snapshot.completion!.devices[0].missingCount, 1);
  assert.equal(snapshot.completion!.devices[0].label, "Completion link");
  const otherEvent = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Other completion event",
      endDate: "2030-04-21",
    },
    actor,
  );
  const otherAssignmentId = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: otherAssignmentId,
      campaignId: campaign.id,
      eventId: otherEvent.savedId,
      name: "Separate completion scope",
      kind: "scattered",
      householdIds: [visit.householdId],
    },
    actor,
  );
  const otherLink = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId: otherAssignmentId,
      label: "Other completion link",
    },
    actor,
  );
  const foreign = {
    ...visit,
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: otherAssignmentId,
  };
  await submitHostedOperation(runtime, otherLink.token!, foreign);
  await assert.rejects(
    submitHostedCompletion(runtime, token, {
      ...report,
      id: randomUUID(),
      deviceId: randomUUID(),
      operationIds: [foreign.id],
      pendingIds: [],
    }),
    denied(403),
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, { ...report, state: "working" }),
    denied(409),
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, {
      ...report,
      id: randomUUID(),
      assignmentId: randomUUID(),
    }),
    denied(403),
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, {
      ...report,
      id: randomUUID(),
      owner: "fixture",
    }),
    denied(422),
  );
  await assert.rejects(
    reader.query("SELECT outreach.submit_completion_report($1,$2)", [
      hashToken(token),
      JSON.stringify({ ...report, id: randomUUID(), state: null }),
    ]),
    (e: unknown) =>
      !!e && typeof e === "object" && "code" in e && e.code === "JF422",
  );
  await submitHostedOperation(runtime, token, pending);
  snapshot = await status();
  assert.equal(snapshot.visits.length, 2);
  assert.equal(snapshot.completion!.devices[0].missingCount, 0);
  const fresh = { ...visit, id: randomUUID(), visitId: randomUUID() };
  await submitHostedCompletion(runtime, token, {
    ...report,
    id: randomUUID(),
    version: 3,
    operationIds: [...report.operationIds, fresh.id],
    pendingIds: [fresh.id],
  });
  await submitHostedCompletion(runtime, token, {
    ...report,
    id: randomUUID(),
    version: 2,
    state: "working",
  });
  snapshot = await status();
  assert.equal(snapshot.completion!.devices[0].version, 3);
  assert.equal(snapshot.completion!.devices[0].missingCount, 1);
  await assert.rejects(
    submitHostedCompletion(runtime, token, {
      ...report,
      id: randomUUID(),
      version: 4,
    }),
    denied(409),
  );
  await submitHostedOperation(runtime, token, fresh);
  const resumed = {
    ...report,
    id: randomUUID(),
    version: 4,
    state: "working" as const,
    operationIds: [...report.operationIds, fresh.id],
    pendingIds: [],
  };
  await submitHostedCompletion(runtime, token, resumed);
  assert.equal((await status()).completion!.devices[0].state, "working");
  const other = {
    ...report,
    id: randomUUID(),
    deviceId: randomUUID(),
    operationIds: [],
    pendingIds: [],
  };
  await submitHostedCompletion(runtime, token, other);
  assert.equal((await status()).completion!.devices.length, 2);
  for (const sql of [
    "SELECT * FROM outreach.completion_reports",
    "DELETE FROM outreach.completion_reports",
    "SELECT outreach.completion_snapshot(NULL)",
    "SELECT outreach.record_completion(NULL,NULL,NULL,NULL)",
    "SET ROLE jco_field_executor",
  ])
    await assert.rejects(reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = await pool.query(
      "SELECT has_table_privilege($1,'outreach.completion_reports','SELECT') AS table_read,has_function_privilege($1,'outreach.submit_completion_report(text,jsonb)','EXECUTE') AS submit,has_function_privilege($1,'outreach.field_completion_snapshot(uuid)','EXECUTE') AS snapshot",
      [role],
    );
    assert.deepEqual(access.rows[0], {
      table_read: false,
      submit: false,
      snapshot: false,
    });
  }
  // Existing narrow writer permissions cannot bypass the synthetic stage gate.
  await pool.query("DELETE FROM outreach.deployment");
  await assert.rejects(
    submitHostedCompletion(runtime, token, {
      ...resumed,
      id: randomUUID(),
      version: 5,
    }),
    /Database stage/,
  );
  await assert.rejects(
    reader.query("SELECT outreach.submit_completion_report($1,$2)", [
      hashToken(token),
      JSON.stringify(resumed),
    ]),
    (e: unknown) =>
      !!e && typeof e === "object" && "code" in e && e.code === "JF503",
  );
  await pool.query(
    "INSERT INTO outreach.deployment(singleton,stage) VALUES(true,'synthetic-preview')",
  );
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '1 hour' WHERE id=$1",
    [event.savedId],
  );
  await submitHostedCompletion(runtime, token, {
    ...resumed,
    id: randomUUID(),
    version: 5,
  });
  await assert.rejects(downloadHostedAssignment(runtime, token), denied(403));
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()-interval '73 hours' WHERE id=$1",
    [event.savedId],
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, resumed),
    denied(410),
  );
  await pool.query(
    "UPDATE outreach.events SET ends_at=now()+interval '1 day' WHERE id=$1",
    [event.savedId],
  );
  await hostedFieldAdmin(
    runtime,
    {
      action: "revoke",
      assignmentId,
      id: issued.credentialId!,
      confirmed: true,
    },
    actor,
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, report),
    denied(403),
  );
  await pool.query(
    "UPDATE outreach.credentials SET revoked=false WHERE token_hash=$1",
    [hashToken(token)],
  );
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, report),
    denied(410),
  );
  await assert.rejects(status(), denied(404));
  await pool.query("DELETE FROM outreach.campaigns WHERE id=$1", [campaign.id]);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.completion_reports WHERE assignment_id=$1",
        [assignmentId],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    submitHostedCompletion(runtime, token, report),
    denied(401),
  );
});

test("retention worker deletes only due campaigns, rolls back cascade failures, retries, and exposes no expired identities", async () => {
  const runtime = postgresDatabase(reader),
    actor = randomUUID();
  assert.deepEqual(await readRetentionStatus(runtime, { campaignId: null }), {
    ready: false,
  });
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  try {
    await migrateRetention(postgresDatabase(migrator));
    await migrateRetention(postgresDatabase(migrator));
  } finally {
    await migrator.end();
  }
  await verifyReader(runtime);
  let status = await readRetentionStatus(runtime, { campaignId: null });
  assert.ok(status.ready);
  assert.equal(status.health, "not_started");
  assert.equal(
    status.checkedAt,
    null,
    "migration neither runs nor schedules deletion",
  );
  await assert.rejects(
    readRetentionStatus(runtime, { campaignId: null, delete: true }),
    /valid campaign/,
  );
  for (const sql of [
    "SELECT outreach.run_retention()",
    "DELETE FROM outreach.campaigns",
    "SELECT * FROM outreach.retention_health",
    "SELECT * FROM outreach.retention_failures",
    "SET ROLE jco_retention_executor",
  ])
    await assert.rejects(reader.query(sql), /permission denied/);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const acl = await pool.query(
      "SELECT has_function_privilege($1,'outreach.run_retention()','EXECUTE') AS run,has_function_privilege($1,'outreach.retention_status(uuid)','EXECUTE') AS read,has_table_privilege($1,'outreach.retention_failures','SELECT') AS failures",
      [role],
    );
    assert.deepEqual(acl.rows[0], { run: false, read: false, failures: false });
  }
  const campaign = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Retention test", endDate: "2030-05-01" },
    actor,
  );
  const untouched = await createHostedCampaign(
    runtime,
    { id: randomUUID(), name: "Keep future campaign", endDate: "2031-05-01" },
    actor,
  );
  const { preview } = validateImport(
    rehearsalCsv("valid-couple-and-buildings"),
  );
  await hostedImport(
    runtime,
    {
      action: "finalize",
      campaignId: campaign.id,
      caseId: "valid-couple-and-buildings",
      digest: preview.digest,
      confirmed: true,
    },
    actor,
  );
  const event = await assignmentAdmin(
    runtime,
    {
      action: "event",
      id: randomUUID(),
      campaignId: campaign.id,
      name: "Retention event",
      endDate: "2030-04-20",
    },
    actor,
  );
  const assignmentId = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "assignment",
      id: assignmentId,
      campaignId: campaign.id,
      eventId: event.savedId,
      name: "Retention walk",
      kind: "scattered",
      householdIds: event.workspace.households.map((h) => h.id),
    },
    actor,
  );
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId,
      label: "Retention fixture link",
    },
    actor,
  );
  const token = issued.token!;
  const downloaded = await downloadHostedAssignment(runtime, token);
  const household = downloaded.households[0];
  const visit: VisitOperation = {
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId,
    householdId: household.id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: "visit",
    result: "resident",
    programs: [],
    doNotContact: true,
    help: {
      id: randomUUID(),
      personId: household.people[0].id,
      phone: "2015550100",
      consent: true,
      arrangement: "return",
    },
    corrections: [
      { id: randomUUID(), kind: "moved", personId: household.people[0].id },
    ],
  };
  await submitHostedOperation(runtime, token, visit);
  await helpAdmin(
    runtime,
    {
      action: "update",
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: visit.help!.id,
      expectedVersion: 0,
      status: "In progress",
    },
    actor,
  );
  await correctionAdmin(
    runtime,
    {
      action: "update",
      id: randomUUID(),
      campaignId: campaign.id,
      reportId: visit.corrections[0].id,
      expectedVersion: 0,
      status: "Reviewed",
    },
    actor,
  );
  const revision = {
    id: randomUUID(),
    assignmentId,
    createdAt: new Date().toISOString(),
    schemaVersion: 1 as const,
    kind: "revision" as const,
    visitId: visit.visitId,
    householdId: household.id,
    originalOperationId: visit.id,
    previousOperationId: visit.id,
    result: "other" as const,
  };
  await submitHostedOperation(runtime, token, revision);
  const building = {
    id: randomUUID(),
    assignmentId,
    schemaVersion: 1 as const,
    createdAt: new Date().toISOString(),
    kind: "building" as const,
    buildingId: household.buildingId,
    reason: "locked" as const,
  };
  await submitHostedOperation(runtime, token, building);
  await submitHostedCompletion(runtime, token, {
    id: randomUUID(),
    assignmentId,
    deviceId: randomUUID(),
    version: 1,
    state: "finished",
    operationIds: [visit.id, revision.id, building.id],
    pendingIds: [],
    createdAt: new Date().toISOString(),
  });
  status = await readRetentionStatus(runtime, { campaignId: campaign.id });
  assert.ok(status.ready);
  assert.equal(status.selected?.openHelpRequests, 1);
  const reassignedId = randomUUID();
  await assignmentAdmin(
    runtime,
    {
      action: "reassign",
      id: reassignedId,
      campaignId: campaign.id,
      sourceId: assignmentId,
      name: "Reassigned retention fixture",
      householdIds: [downloaded.households[1].id],
      confirmed: true,
    },
    actor,
  );
  // Include the legacy rehearsal pointer; it must not leave imported identities behind.
  await pool.query(
    "INSERT INTO outreach.import_rehearsals(campaign_id,end_at,assignment_id) VALUES($1,$2,$3)",
    [campaign.id, campaign.endAt, assignmentId],
  );
  const identifiers = [
    campaign.id,
    reassignedId,
    assignmentId,
    event.savedId,
    visit.id,
    revision.id,
    building.id,
    visit.visitId,
    ...downloaded.households.flatMap((h) => [
      h.id,
      h.buildingId,
      ...h.people.map((p) => p.id),
    ]),
  ];
  const tables = [
    "campaigns",
    "events",
    "assignments",
    "households",
    "people",
    "memberships",
    "credentials",
    "operations",
    "visits",
    "help_requests",
    "corrections",
    "building_attempts",
    "imports",
    "buildings",
    "import_people",
    "completion_reports",
    "help_status_changes",
    "correction_status_changes",
    "reassignments",
    "import_rehearsals",
  ];
  const rowCounts = async () => {
    const result: Record<string, number> = {};
    for (const table of tables)
      result[table] = (
        await pool.query(
          `SELECT count(*)::int AS n FROM outreach.${table} t WHERE to_jsonb(t)::text LIKE ANY($1::text[])`,
          [identifiers.map((id) => `%${id}%`)],
        )
      ).rows[0].n;
    return result;
  };
  const original = await rowCounts();
  for (const table of tables)
    assert.ok(original[table] > 0, `fixture exercises ${table}`);
  await pool.query("SELECT outreach.run_retention()");
  assert.deepEqual(
    await rowCounts(),
    original,
    "not-yet-due campaign remains intact",
  );
  const baseline = await readRetentionStatus(runtime, { campaignId: null });
  assert.ok(baseline.ready);
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [campaign.id],
  );
  // A late child failure must roll back every earlier cascade within this campaign.
  await pool.query(
    "CREATE FUNCTION outreach.test_retention_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SENSITIVE_FIXTURE_MUST_NOT_BE_STORED'; END $$; CREATE TRIGGER test_retention_failure BEFORE DELETE ON outreach.help_requests FOR EACH ROW EXECUTE FUNCTION outreach.test_retention_failure()",
  );
  await pool.query("SELECT outreach.run_retention()");
  assert.deepEqual(await rowCounts(), original);
  status = await readRetentionStatus(runtime, { campaignId: campaign.id });
  assert.ok(status.ready);
  assert.equal(status.health, "recent");
  assert.equal(status.overdueCampaigns, 1);
  assert.equal(status.failedCampaigns, 1);
  assert.equal(
    status.selected,
    null,
    "expired name and open-task detail are never returned",
  );
  assert.equal(JSON.stringify(status).includes(campaign.id), false);
  assert.equal(
    JSON.stringify(
      (await pool.query("SELECT * FROM outreach.retention_failures")).rows,
    ).includes("SENSITIVE"),
    false,
  );
  assert.ok(
    !(await listHostedCampaigns(runtime)).some((c) => c.id === campaign.id),
  );
  await assert.rejects(
    downloadHostedAssignment(runtime, token),
    (e: unknown) => e instanceof DomainError && e.status === 410,
  );
  await assert.rejects(
    submitHostedOperation(runtime, token, visit),
    (e: unknown) => e instanceof DomainError && e.status === 410,
  );
  await pool.query(
    "DROP TRIGGER test_retention_failure ON outreach.help_requests; DROP FUNCTION outreach.test_retention_failure()",
  );
  // Concurrent runners either serialize or skip; neither duplicates success counts.
  await Promise.all([
    pool.query("SELECT outreach.run_retention()"),
    pool.query("SELECT outreach.run_retention()"),
  ]);
  assert.deepEqual(
    await rowCounts(),
    Object.fromEntries(tables.map((t) => [t, 0])),
  );
  status = await readRetentionStatus(runtime, { campaignId: null });
  assert.ok(status.ready);
  assert.equal(status.failedCampaigns, 0);
  assert.equal(status.overdueCampaigns, 0);
  assert.equal(status.deletedCampaigns, baseline.deletedCampaigns + 1);
  await pool.query("SELECT outreach.run_retention()");
  assert.deepEqual(
    (await readRetentionStatus(runtime, { campaignId: null })).ready,
    true,
  );
  const afterRetry = await readRetentionStatus(runtime, { campaignId: null });
  assert.ok(afterRetry.ready);
  assert.equal(afterRetry.deletedCampaigns, status.deletedCampaigns);
  // Simulate an expired parent restored from an old backup: deadline authorization
  // still denies reads, and the worker removes it again without a tombstone bypass.
  await pool.query(
    "INSERT INTO outreach.campaigns(id,name,deletion_at) VALUES($1,'Synthetic restored expired campaign',now()-interval '1 day')",
    [campaign.id],
  );
  assert.ok(
    !(await listHostedCampaigns(runtime)).some((c) => c.id === campaign.id),
  );
  await pool.query("SELECT outreach.run_retention()");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.campaigns WHERE id=$1",
        [campaign.id],
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    (await listHostedCampaigns(runtime)).some((c) => c.id === untouched.id),
  );
  await assert.rejects(
    submitHostedOperation(runtime, token, visit),
    (e: unknown) => e instanceof DomainError && e.status === 401,
  );
  await pool.query(
    "UPDATE outreach.retention_health SET checked_at=now()-interval '6 minutes'",
  );
  const stale = await readRetentionStatus(runtime, { campaignId: null });
  assert.ok(stale.ready);
  assert.equal(
    stale.health,
    "stale",
    "whole-job failures/stopped scheduling cannot look healthy indefinitely",
  );
  await pool.query("DELETE FROM outreach.deployment");
  await assert.rejects(
    pool.query("SELECT outreach.run_retention()"),
    /Synthetic deployment required/,
  );
  await pool.query(
    "INSERT INTO outreach.deployment VALUES(true,'synthetic-preview')",
  );
  await verifyReader(runtime);
});

test("operator rehearsal is atomic, refuses unsafe setup, preserves existing data and requires a scheduler receipt", async () => {
  // This test owns an isolated temporary cluster. Cron tables below are explicit
  // stubs: only the separate live operator run can establish scheduled execution.
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  const owner = postgresDatabase(migrator),
    runtime = postgresDatabase(reader);
  try {
    await pool.query("SELECT outreach.run_retention()");
    const initial = (
      await pool.query("SELECT count(*)::int AS n FROM outreach.campaigns")
    ).rows[0].n;
    await assert.rejects(prepareRetentionRehearsal(owner));
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM outreach.campaigns"))
        .rows[0].n,
      initial,
    );
    await pool.query(`CREATE SCHEMA cron;
      CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text, username text, active boolean, schedule text, command text, database text);
      CREATE TABLE cron.job_run_details(jobid bigint, status text, start_time timestamptz, end_time timestamptz);
      GRANT USAGE ON SCHEMA cron TO "jco-test-migrator";
      GRANT SELECT ON ALL TABLES IN SCHEMA cron TO "jco-test-migrator"`);
    await pool.query(
      "INSERT INTO cron.job VALUES(1,$1,'jco-test-migrator',false,'* * * * *',$2,'postgres')",
      [RETENTION_JOB, RETENTION_COMMAND],
    );
    await assert.rejects(
      prepareRetentionRehearsal(owner),
      /schedule must match/,
    );
    await pool.query("UPDATE cron.job SET active=true");
    // A late setup failure must roll back the new campaign and every child.
    await pool.query(`CREATE FUNCTION outreach.test_rehearsal_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fixture failure'; END $$;
      CREATE TRIGGER test_rehearsal_failure BEFORE INSERT ON outreach.import_rehearsals FOR EACH ROW EXECUTE FUNCTION outreach.test_rehearsal_failure()`);
    await assert.rejects(prepareRetentionRehearsal(owner), /Fixture failure/);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM outreach.campaigns"))
        .rows[0].n,
      initial,
    );
    await pool.query(
      "DROP TRIGGER test_rehearsal_failure ON outreach.import_rehearsals; DROP FUNCTION outreach.test_rehearsal_failure()",
    );
    const fixture = await prepareRetentionRehearsal(owner);
    const visible = await readRetentionStatus(runtime, {
      campaignId: fixture.campaignId,
    });
    assert.ok(visible.ready);
    assert.equal(visible.selected?.campaignId, fixture.campaignId);
    assert.equal(visible.selected?.openHelpRequests, 1);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM outreach.campaigns"))
        .rows[0].n,
      initial + 1,
    );
    await assert.rejects(
      prepareRetentionRehearsal(owner),
      /no pending rehearsal/,
    );
    assert.equal(
      (await inspectRetentionRehearsal(owner, fixture)).complete,
      false,
    );
    const timing = await pool.query(
      "SELECT deletion_at=((end_at AT TIME ZONE 'America/New_York')+interval '30 days') AT TIME ZONE 'America/New_York' AS valid FROM outreach.campaigns WHERE id=$1",
      [fixture.campaignId],
    );
    assert.equal(timing.rows[0].valid, true);
    // Accelerate only this test-created fixture in the isolated cluster.
    const expired = new Date(Date.now() - 1000).toISOString();
    await pool.query(
      "UPDATE outreach.campaigns SET deletion_at=$2::timestamptz,end_at=(($2::timestamptz AT TIME ZONE 'America/New_York')-interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
      [fixture.campaignId, expired],
    );
    const accelerated = { ...fixture, deletionAt: expired };
    await pool.query("SELECT outreach.run_retention()");
    assert.deepEqual(
      await inspectRetentionRehearsal(owner, accelerated),
      { complete: false, remaining: 0 },
      "deleted rows without Cron receipt cannot pass",
    );
    await pool.query(
      "INSERT INTO cron.job_run_details VALUES(1,'succeeded',now(),now())",
    );
    assert.deepEqual(await inspectRetentionRehearsal(owner, accelerated), {
      complete: true,
      remaining: 0,
      tablesChecked: 20,
      scheduledRunConfirmed: true,
    });
    await verifyDeletedCredential(runtime, fixture);
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM outreach.campaigns"))
        .rows[0].n,
      initial,
    );
    // A competing unrelated edit makes preservation inconclusive, never success.
    await pool.query(
      "INSERT INTO outreach.campaigns(id,name,deletion_at) VALUES($1,'Unrelated concurrent fixture',now()+interval '1 year')",
      [randomUUID()],
    );
    await assert.rejects(
      inspectRetentionRehearsal(owner, accelerated),
      /Unrelated records changed/,
    );
    await verifyReader(runtime);
  } finally {
    await migrator.end();
  }
});

test("actual isolated archive restore preserves expiry and permissions, rolls back failed cleanup, then safely retries", async () => {
  // All connections use the random Unix-socket cluster created by this file.
  // Never read DATABASE_URL or any hosted data. Existing global TEST roles are
  // shared across these two local databases; this is not a provider restore.
  const migrator = new Pool({
    host: directory,
    port: 55439,
    database: "postgres",
    user: "jco-test-migrator",
  });
  const restored = new Pool({
    host: directory,
    port: 55439,
    database: "jco_restore_fixture",
    user: "jco_test_owner",
  });
  const blockedReader = new Pool({
    host: directory,
    port: 55439,
    database: "jco_restore_fixture",
    user: "jco_admin_reader",
  });
  const archive = join(directory, "synthetic-retention.dump");
  const owner = postgresDatabase(restored);
  // Probe restored application privileges without reopening database CONNECT to
  // the runtime. SET LOCAL ROLE is confined to this isolated operator session.
  const runtime: Database = {
    ...owner,
    transaction: (work) =>
      owner.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE jco_admin_reader");
        return work(tx);
      }),
  };
  const snapshot = async (database: Pool) => {
    const result: Record<string, { count: number; digest: string }> = {};
    for (const table of retentionTables) {
      result[table] = (
        await database.query(
          `SELECT count(*)::int AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM outreach.${table} t`,
        )
      ).rows[0];
    }
    return result;
  };
  try {
    await pool.query("SELECT outreach.run_retention()");
    const fixture = await prepareRetentionRehearsal(postgresDatabase(migrator));
    // Simulate a backup containing expired records awaiting cleanup. Set the
    // fixture clock BEFORE capture; never extend/rewrite deadlines on restore.
    const expiredAt = new Date(Date.now() - 1000).toISOString();
    await pool.query(
      "UPDATE outreach.campaigns SET deletion_at=$2::timestamptz,end_at=(($2::timestamptz AT TIME ZONE 'America/New_York')-interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
      [fixture.campaignId, expiredAt],
    );
    const captured = await snapshot(pool);
    const versions = (
      await pool.query(
        "SELECT name,checksum FROM outreach.schema_migrations ORDER BY name",
      )
    ).rows;
    execFileSync(
      join(bin, "pg_dump"),
      [
        "--host",
        directory,
        "--port",
        "55439",
        "--username",
        "jco_test_owner",
        "--dbname",
        "postgres",
        "--no-password",
        "--format=custom",
        "--schema=outreach",
        "--file",
        archive,
      ],
      { stdio: "pipe", timeout: 30000 },
    );
    await chmod(archive, 0o600);
    // Source cleanup proves that restoring really reintroduces previously
    // deleted fixture rows. It is not represented as scheduled-run evidence.
    await pool.query("SELECT outreach.run_retention()");
    const cleanedSource = await snapshot(pool);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.campaigns WHERE id=$1",
          [fixture.campaignId],
        )
      ).rows[0].n,
      0,
    );

    await pool.query("CREATE DATABASE jco_restore_fixture TEMPLATE template0");
    await pool.query(
      "REVOKE CONNECT ON DATABASE jco_restore_fixture FROM PUBLIC, jco_admin_reader, anon, authenticated, service_role",
    );
    await assert.rejects(
      blockedReader.query("SELECT 1"),
      /permission denied for database/,
    );
    execFileSync(
      join(bin, "pg_restore"),
      [
        "--host",
        directory,
        "--port",
        "55439",
        "--username",
        "jco_test_owner",
        "--dbname",
        "jco_restore_fixture",
        "--no-password",
        "--single-transaction",
        "--exit-on-error",
        archive,
      ],
      { stdio: "pipe", timeout: 30000 },
    );
    assert.deepEqual(
      await snapshot(restored),
      captured,
      "archive restores data across every campaign table exactly",
    );
    assert.deepEqual(
      (
        await restored.query(
          "SELECT name,checksum FROM outreach.schema_migrations ORDER BY name",
        )
      ).rows,
      versions,
    );
    assert.equal(
      (
        await restored.query(
          "SELECT deletion_at FROM outreach.campaigns WHERE id=$1",
          [fixture.campaignId],
        )
      ).rows[0].deletion_at.toISOString(),
      expiredAt,
    );
    assert.equal(
      (await restored.query("SELECT to_regclass('cron.job') AS job")).rows[0]
        .job,
      null,
      "outreach-only restore must not install or start external jobs",
    );
    await assert.rejects(
      blockedReader.query("SELECT 1"),
      /permission denied for database/,
    );
    await runtime.transaction(async (tx) => {
      await verifyReader({ ...tx, transaction: async (work) => work(tx) });
    });
    for (const role of ["anon", "authenticated", "service_role"]) {
      const permissions = (
        await restored.query(
          "SELECT has_schema_privilege($1,'outreach','USAGE') AS schema_access,has_function_privilege($1,'outreach.run_retention()','EXECUTE') AS deletion,has_table_privilege($1,'outreach.people','SELECT') AS people",
          [role],
        )
      ).rows[0];
      assert.deepEqual(permissions, {
        schema_access: false,
        deletion: false,
        people: false,
      });
    }
    const assertExpired = async () => {
      assert.ok(
        !(await listHostedCampaigns(runtime)).some(
          (c) => c.id === fixture.campaignId,
        ),
      );
      for (const probe of [
        () => downloadHostedAssignment(runtime, fixture.token),
        () => submitHostedOperation(runtime, fixture.token, fixture.visit),
      ])
        await assert.rejects(
          probe(),
          (error: unknown) =>
            error instanceof DomainError && error.status === 410,
        );
    };
    await assertExpired();
    // Fault exists only in the newly created restore-test database, never in
    // Supabase or the source database. Late failure must roll back all children.
    await restored.query(`CREATE FUNCTION outreach.test_restore_cleanup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PRIVATE_FAULT_DETAIL'; END $$;
      CREATE TRIGGER test_restore_cleanup_failure BEFORE DELETE ON outreach.help_requests FOR EACH ROW EXECUTE FUNCTION outreach.test_restore_cleanup_failure()`);
    await restored.query("SELECT outreach.run_retention()");
    assert.deepEqual(
      await snapshot(restored),
      captured,
      "failed cascade must not partially erase restored data",
    );
    const failure = await readRetentionStatus(runtime, {
      campaignId: fixture.campaignId,
    });
    assert.ok(failure.ready);
    assert.equal(failure.failedCampaigns, 1);
    assert.equal(failure.overdueCampaigns, 1);
    assert.equal(failure.selected, null);
    assert.equal(
      JSON.stringify(
        (await restored.query("SELECT * FROM outreach.retention_failures"))
          .rows,
      ).includes("PRIVATE_FAULT_DETAIL"),
      false,
    );
    await assertExpired();
    await restored.query(
      "DROP TRIGGER test_restore_cleanup_failure ON outreach.help_requests; DROP FUNCTION outreach.test_restore_cleanup_failure()",
    );
    await restored.query("SELECT outreach.run_retention()");
    assert.deepEqual(
      await snapshot(restored),
      cleanedSource,
      "retry removes all expired descendants while active records survive",
    );
    await verifyDeletedCredential(runtime, fixture);
    const recovered = await readRetentionStatus(runtime, { campaignId: null });
    assert.ok(recovered.ready);
    assert.equal(recovered.failedCampaigns, 0);
    assert.equal(recovered.overdueCampaigns, 0);
    await restored.query("SELECT outreach.run_retention()");
    assert.deepEqual(
      await snapshot(restored),
      cleanedSource,
      "repeat cleanup is a no-op",
    );
    assert.deepEqual(
      await snapshot(pool),
      cleanedSource,
      "restore target never mutates its source",
    );
    await assert.rejects(
      blockedReader.query("SELECT 1"),
      /permission denied for database/,
    );
  } finally {
    await Promise.all([migrator.end(), restored.end(), blockedReader.end()]);
    await rm(archive, { force: true });
    // The test suite stops and removes its entire task-owned temporary cluster.
    // No generic DROP/restore/cleanup command is pointed at a configured server.
  }
});

test("role-scoped logging protection removes synthetic payloads from actual server logs without changing error delivery or permissions", async () => {
  // Disposable native cluster only. Never run this fault/log probe on Supabase.
  // Earlier migration tests intentionally transferred table ownership. Restore
  // this fixture's owner identity so the operator scope check is exercised.
  await pool.query("ALTER TABLE outreach.campaigns OWNER TO jco_test_owner");
  await pool.query(`ALTER ROLE jco_admin_reader SET session_preload_libraries='auto_explain';
    ALTER ROLE jco_admin_reader SET auto_explain.log_min_duration=0;
    ALTER ROLE jco_admin_reader SET auto_explain.log_parameter_max_length=-1;
    CREATE FUNCTION public.jco_logging_fixture(payload text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
    BEGIN RAISE WARNING '%',payload; RAISE EXCEPTION USING MESSAGE=payload,DETAIL=payload; END $$;
    REVOKE ALL ON FUNCTION public.jco_logging_fixture(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.jco_logging_fixture(text) TO jco_admin_reader;`);
  const makeReader = () =>
    new Pool({
      host: directory,
      port: 55439,
      database: "postgres",
      user: "jco_admin_reader",
      max: 1,
    });
  const stale = makeReader();
  const fresh = makeReader();
  const staleClient = await stale.connect();
  const readLog = () => readFile(join(directory, "server.log"), "utf8");
  const unsafeCanary = `SYNTHETIC_UNSAFE_${randomUUID()}`;
  const protectedCanary = `SYNTHETIC_PROTECTED_${randomUUID()}`;
  try {
    await assert.rejects(
      staleClient.query("SELECT public.jco_logging_fixture($1)", [
        unsafeCanary,
      ]),
      { code: "P0001" },
    );
    for (
      let attempt = 0;
      attempt < 20 && !(await readLog()).includes(unsafeCanary);
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(
      (await readLog()).includes(unsafeCanary),
      "baseline reproduces parameter/error disclosure in a real server log",
    );
    const before = (
      await pool.query(
        "SELECT rolconfig FROM pg_roles WHERE rolname='jco_admin_reader'",
      )
    ).rows;
    const db = postgresDatabase(pool);
    const failing: Database = {
      ...db,
      transaction: (work) =>
        db.transaction(async (tx) => {
          let changed = 0;
          return work({
            ...tx,
            async exec(sql) {
              await tx.exec(sql);
              if (sql.startsWith("ALTER ROLE") && ++changed === 2)
                throw Error("Synthetic configuration interruption");
            },
          });
        }),
    };
    await assert.rejects(
      configureRuntimeLogging(failing, async () => {}),
      /Synthetic configuration interruption/,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT rolconfig FROM pg_roles WHERE rolname='jco_admin_reader'",
        )
      ).rows,
      before,
      "partial configuration rolls back",
    );
    let captured = false;
    await configureRuntimeLogging(db, async (snapshot) => {
      captured = true;
      assert.ok(snapshot.settings.includes("auto_explain.log_min_duration=0"));
      assert.ok(
        !snapshot.settings.some((value) =>
          value.startsWith("session_preload_libraries="),
        ),
      );
    });
    assert.equal(captured, true);
    assert.equal(
      (await staleClient.query("SHOW log_min_messages")).rows[0]
        .log_min_messages,
      "warning",
      "already-open sessions need recycling",
    );
    const audit = await inspectUploadLogging(postgresDatabase(fresh));
    assert.equal(audit.routineErrorTextSuppressed, true);
    assert.ok(
      audit.checks
        .filter((check) => !check.setting.startsWith("pgaudit."))
        .every((check) => check.status === "pass"),
      "local server has auto_explain, but does not provide pgAudit",
    );
    const offset = (await readLog()).length;
    await fresh.query("SELECT $1::text", [protectedCanary]);
    await assert.rejects(
      fresh.query("SELECT public.jco_logging_fixture($1)", [protectedCanary]),
      { code: "P0001" },
    );
    await assert.rejects(fresh.query("SELECT $1::integer", [protectedCanary]), {
      code: "22P02",
    });
    await fresh.query("SELECT 1");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      (await readLog()).slice(offset).includes(protectedCanary),
      false,
      "bind values, primary errors, DETAIL, WARNING and context stay out of the server log",
    );
    assert.equal(
      (await pool.query("SHOW log_min_messages")).rows[0].log_min_messages,
      "warning",
      "owner/other session logging is unchanged",
    );
    await pool.query("DROP FUNCTION public.jco_logging_fixture(text)");
    await verifyReader(postgresDatabase(fresh));
    await assert.rejects(fresh.query("SELECT * FROM outreach.people"), {
      code: "42501",
    });
  } finally {
    staleClient.release();
    await Promise.all([stale.end(), fresh.end()]);
  }
});

test("general CSV engine validates at the database boundary, saves atomically and preserves immutable actor-bound retries", async () => {
  const owner = postgresDatabase(pool),
    runtime = postgresDatabase(reader);
  await owner.transaction((tx) =>
    migrate({ ...tx, transaction: (work) => work(tx) }, ["014_csv_import.sql"]),
  );
  await owner.transaction((tx) =>
    migrate({ ...tx, transaction: (work) => work(tx) }, ["014_csv_import.sql"]),
  );
  for (const role of [
    "public",
    "anon",
    "authenticated",
    "service_role",
    "jco_admin_reader",
  ])
    assert.equal(
      (
        await pool.query(
          "SELECT has_function_privilege($1,'outreach.finalize_csv_import(uuid,text,jsonb,uuid)','EXECUTE') AS allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  // A test-only grant in this disposable cluster. The migration deliberately
  // provides no hosted runtime authorization or raw-upload route.
  await pool.query(
    "GRANT EXECUTE ON FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) TO jco_admin_reader",
  );
  const actor = randomUUID();
  const newCampaign = async () =>
    await createHostedCampaign(
      runtime,
      { id: randomUUID(), name: "CSV engine fixture", endDate: "2030-12-01" },
      actor,
    );
  const csv = rehearsalCsv("valid-couple-and-buildings");
  const parsed = validateImport(csv);
  const previewRequest = (id: string) => ({
    action: "preview",
    campaignId: id,
  });
  const finalizeRequest = (id: string) => ({
    action: "finalize",
    campaignId: id,
    digest: parsed.preview.digest,
    confirmed: true,
  });
  const count = async (id: string) =>
    (
      await pool.query(
        `SELECT
    (SELECT count(*)::integer FROM outreach.imports WHERE campaign_id=$1) AS imports,
    (SELECT count(*)::integer FROM outreach.households WHERE campaign_id=$1) AS households,
    (SELECT count(*)::integer FROM outreach.import_people WHERE campaign_id=$1) AS people`,
        [id],
      )
    ).rows[0];
  const empty = { imports: 0, households: 0, people: 0 };
  try {
    const campaign = await newCampaign();
    const preview = await importCsvBytes(
      runtime,
      previewRequest(campaign.id),
      csv,
      actor,
    );
    assert.ok("preview" in preview && preview.preview.valid);
    assert.deepEqual(await count(campaign.id), empty);
    const malformed: unknown[] = [
      null,
      {},
      [],
      [null],
      parsed.rows.map((r, i) => (i ? r : { ...r, Tier: "3" })),
      parsed.rows.map((r, i) => (i ? r : { ...r, Tier: "" })),
      parsed.rows.map((r, i) => (i ? r : { ...r, Score: "999" })),
      [...parsed.rows, parsed.rows[0]],
      parsed.rows.map((r, i) =>
        i !== 1 ? r : { ...r, "Unit (verified)": "3C" },
      ),
      parsed.rows.map((r, i) => (i ? r : { ...r, Zip: "7304" })),
      parsed.rows.map((r, i) => (i ? r : { ...r, "First Name": null })),
    ];
    for (const rows of malformed) {
      await assert.rejects(
        reader.query(
          "SELECT outreach.finalize_csv_import($1,$2,$3::jsonb,$4)",
          [campaign.id, parsed.preview.digest, JSON.stringify(rows), actor],
        ),
        { code: "JC002" },
      );
      assert.deepEqual(await count(campaign.id), empty);
    }
    const saved = await Promise.all([
      importCsvBytes(runtime, finalizeRequest(campaign.id), csv, actor),
      importCsvBytes(runtime, finalizeRequest(campaign.id), csv, actor),
    ]);
    assert.deepEqual(saved[0], saved[1]);
    assert.deepEqual(await count(campaign.id), {
      imports: 1,
      households: 3,
      people: 4,
    });
    assert.equal(
      (await listHostedCampaigns(runtime)).find((c) => c.id === campaign.id)
        ?.importReceipt?.counts.people,
      4,
    );
    await assert.rejects(
      importCsvBytes(runtime, finalizeRequest(campaign.id), csv, randomUUID()),
      (error) => error instanceof DomainError && error.status === 409,
    );
    const changed = structuredClone(parsed.rows);
    changed[0]["First Name"] = "Changed Fixture";
    await assert.rejects(
      reader.query("SELECT outreach.finalize_csv_import($1,$2,$3::jsonb,$4)", [
        campaign.id,
        parsed.preview.digest,
        JSON.stringify(changed),
        actor,
      ]),
      { code: "JC003" },
    );
    assert.deepEqual(await count(campaign.id), {
      imports: 1,
      households: 3,
      people: 4,
    });
    const failing = await newCampaign();
    await pool.query(`CREATE FUNCTION public.jco_csv_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_id='00000004' THEN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER jco_csv_failure BEFORE INSERT ON outreach.import_people FOR EACH ROW EXECUTE FUNCTION public.jco_csv_failure()`);
    try {
      await assert.rejects(
        importCsvBytes(runtime, finalizeRequest(failing.id), csv, actor),
        (error) =>
          error instanceof DomainError &&
          error.status === 503 &&
          !error.message.includes("SYNTHETIC_PRIVATE_FAILURE"),
      );
      assert.deepEqual(
        await count(failing.id),
        empty,
        "a late row failure rolls back the receipt and all earlier rows",
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::integer AS count FROM outreach.buildings WHERE campaign_id=$1",
            [failing.id],
          )
        ).rows[0].count,
        0,
      );
    } finally {
      await pool.query(
        "DROP TRIGGER jco_csv_failure ON outreach.import_people; DROP FUNCTION public.jco_csv_failure()",
      );
    }
    await importCsvBytes(runtime, finalizeRequest(failing.id), csv, actor);
    assert.deepEqual(await count(failing.id), {
      imports: 1,
      households: 3,
      people: 4,
    });
    const expired = await newCampaign();
    await pool.query(
      "UPDATE outreach.campaigns SET end_at=now()-interval '32 days',deletion_at=((now()-interval '32 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
      [expired.id],
    );
    await assert.rejects(
      importCsvBytes(runtime, previewRequest(expired.id), csv, actor),
      (error) => error instanceof DomainError && error.status === 404,
    );
    await assert.rejects(
      reader.query("SELECT outreach.finalize_csv_import($1,$2,$3::jsonb,$4)", [
        expired.id,
        parsed.preview.digest,
        JSON.stringify(parsed.rows),
        actor,
      ]),
      { code: "JC001" },
    );
    await assert.rejects(
      reader.query(
        "INSERT INTO outreach.people(id,household_id,first_name,last_name) VALUES(gen_random_uuid(),gen_random_uuid(),'Bypass','Fixture')",
      ),
      { code: "42501" },
    );

    // Generated synthetic source, not a renamed built-in fixture: 1,200 people,
    // 1,000 doors, 200 buildings. Includes couples, leading zeros and CSV quoting.
    const largeRows: Record<string, string>[] = [];
    for (let door = 0; door < 1000; door++) {
      const building = Math.floor(door / 5);
      const address = `${100 + building} SYNTHETIC CSV WALK`;
      const unit = String((door % 5) + 1).padStart(2, "0");
      const block = String(10000 + building);
      const members = door < 200 ? 2 : 1;
      for (let member = 0; member < members; member++)
        largeRows.push({
          ...importFixture.records[0],
          VANID: String(largeRows.length + 10000).padStart(8, "0"),
          "First Name": `Synthetic ${door}-${member}`,
          "Last Name": 'Fixture, "García"',
          "Residence Address": `${address} Unit ${unit}`,
          "Property Location": address,
          "Unit (verified)": unit,
          Zip: "07304",
          Ward: "ABCDEF"[building % 6],
          Block: block,
          Lot: "001",
          Qual: `C${unit}`,
          "Household Key": `${block}-001-C${unit}`,
          "Persons in Household": String(members),
          Tier: member ? "2" : "1",
          "Owner of Record": "DISCARDED_SYNTHETIC_CANARY",
          "Match Rationale": "DISCARDED_SYNTHETIC_CANARY",
          Score: "DISCARDED_SYNTHETIC_CANARY",
        });
    }
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const encode = (rows: Record<string, string>[]) =>
      new TextEncoder().encode(
        "\ufeff" +
          [
            sourceHeaders.map(quote).join(","),
            ...rows.map((row) =>
              sourceHeaders.map((h) => quote(row[h])).join(","),
            ),
          ].join("\r\n"),
      );
    const largeCsv = encode(largeRows);
    const large = await newCampaign();
    const largePreview = await importCsvBytes(
      runtime,
      previewRequest(large.id),
      largeCsv,
      actor,
    );
    assert.ok("preview" in largePreview && largePreview.preview.valid);
    assert.deepEqual(largePreview.preview.counts, {
      people: 1200,
      households: 1000,
      buildings: 200,
    });
    assert.equal(largePreview.preview.households.length, 100);
    assert.equal(largePreview.preview.previewTruncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(largePreview)) < 100_000);
    assert.deepEqual(await count(large.id), empty);
    const largeFinalize = {
      ...finalizeRequest(large.id),
      digest: largePreview.preview.digest,
    };
    const forbidden = structuredClone(largeRows);
    forbidden[1199].Tier = "3";
    const rejected = await importCsvBytes(
      runtime,
      previewRequest(large.id),
      encode(forbidden),
      actor,
    );
    assert.ok(
      "preview" in rejected &&
        !rejected.preview.valid &&
        rejected.preview.households.length === 0,
    );
    await assert.rejects(
      importCsvBytes(runtime, largeFinalize, encode(forbidden), actor),
      (error) => error instanceof DomainError && error.status === 422,
    );
    assert.deepEqual(await count(large.id), empty);
    await importCsvBytes(runtime, largeFinalize, largeCsv, actor);
    assert.deepEqual(await count(large.id), {
      imports: 1,
      households: 1000,
      people: 1200,
    });
    const stored = await pool.query(
      "SELECT to_jsonb(p) AS row FROM outreach.import_people p WHERE campaign_id=$1 ORDER BY source_id",
      [large.id],
    );
    assert.equal(stored.rows[0].row.source_id, "00010000");
    assert.equal(stored.rows[0].row.zip, "07304");
    assert.equal(stored.rows[0].row.verified_unit, "01");
    assert.doesNotMatch(
      JSON.stringify(stored.rows),
      /DISCARDED_SYNTHETIC_CANARY/,
    );

    const event = await assignmentAdmin(
      runtime,
      {
        action: "event",
        campaignId: large.id,
        id: randomUUID(),
        name: "General CSV field loop",
        endDate: "2030-11-20",
      },
      actor,
    );
    assert.equal(event.workspace.households.length, 1000);
    const couple = event.workspace.households.find((h) => h.peopleCount === 2)!;
    const other = event.workspace.households.find(
      (h) => h.buildingId !== couple.buildingId,
    )!;
    const aid = randomUUID();
    await assignmentAdmin(
      runtime,
      {
        action: "assignment",
        campaignId: large.id,
        eventId: event.savedId,
        id: aid,
        name: "CSV volunteer",
        kind: "scattered",
        householdIds: [other.id, couple.id],
      },
      actor,
    );
    const issued = await hostedFieldAdmin(
      runtime,
      { action: "issue", assignmentId: aid, id: randomUUID() },
      actor,
    );
    const assignment = await downloadHostedAssignment(runtime, issued.token!);
    assert.deepEqual(
      assignment.households.map((h) => h.id),
      [other.id, couple.id],
    );
    assert.equal(assignment.households[1].people.length, 2);
    assert.equal(
      assignment.households[1].people[0].lastName,
      'Fixture, "García"',
    );
    assert.doesNotMatch(
      JSON.stringify(assignment),
      /VANID|source_id|Tier|Owner|Rationale|Score|DISCARDED_SYNTHETIC_CANARY/,
    );
    const op: VisitOperation = {
      id: randomUUID(),
      visitId: randomUUID(),
      assignmentId: aid,
      householdId: couple.id,
      createdAt: new Date().toISOString(),
      schemaVersion: 1,
      kind: "visit",
      result: "resident",
      programs: ["freeze"],
      help: null,
      corrections: [],
      doNotContact: false,
    };
    const receipt = await submitHostedOperation(runtime, issued.token!, op);
    assert.deepEqual(
      await submitHostedOperation(runtime, issued.token!, op),
      receipt,
    );
    const received = await hostedFieldAdmin(
      runtime,
      { action: "status", assignmentId: aid },
      actor,
    );
    assert.deepEqual(received.snapshot.counts, {
      attempts: 1,
      repeats: 0,
      conversations: 1,
    });
  } finally {
    await pool.query(
      "REVOKE EXECUTE ON FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) FROM jco_admin_reader",
    );
  }
  await verifyReader(runtime);
});

test("live activation preserves practice data and atomic paired preload survives retries, field sync and retention", async () => {
  const owner = postgresDatabase(pool),
    runtime = postgresDatabase(reader);
  const before = (
    await pool.query(
      "SELECT id,name,end_at,deletion_at FROM outreach.campaigns ORDER BY id",
    )
  ).rows;
  await migrateLive(owner);
  await migrateLive(owner);
  assert.equal(
    (await pool.query("SELECT stage FROM outreach.deployment")).rows[0].stage,
    "synthetic-preview",
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT id,name,end_at,deletion_at FROM outreach.campaigns ORDER BY id",
      )
    ).rows,
    before,
  );
  await verifyReader(runtime);
  await assert.rejects(
    reader.query("SELECT * FROM outreach.create_live_campaign($1,$2,$3,$4)", [
      randomUUID(),
      "Synthetic test of live mode",
      "2030-10-18",
      randomUUID(),
    ]),
    { code: "JC004" },
  );
  for (const role of ["public", "anon", "authenticated", "service_role"])
    for (const signature of [
      "outreach.create_live_campaign(uuid,text,date,uuid)",
      "outreach.finalize_csv_import(uuid,text,jsonb,uuid)",
    ])
      assert.equal(
        (
          await pool.query(
            "SELECT has_function_privilege($1,$2,'EXECUTE') AS ok",
            [role, signature],
          )
        ).rows[0].ok,
        false,
      );

  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...importFixture.records[0],
    VANID: String(800000 + index),
    "First Name": `Fixture ${index}`,
    "Last Name": "Synthetic",
    Tier: "1",
    Ward: "A",
    Block: String(3000 + index),
    Lot: "1",
    Qual: "",
    "Household Key": `${3000 + index}-1-`,
    "Residence Address": `${index + 100} SYNTHETIC PRELOAD WALK`,
    "Property Location": `${index + 100} SYNTHETIC PRELOAD WALK`,
    "Unit (verified)": "",
    "Persons in Household": "1",
    Zip: "07304",
  }));
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  const bytes = Buffer.from(
    [
      sourceHeaders.map(quote).join(","),
      ...rows.map((r) =>
        sourceHeaders.map((h) => quote(String(r[h]))).join(","),
      ),
    ].join("\r\n"),
  );
  const validated = validateImport(bytes);
  assert.equal(validated.preview.valid, true);
  const actor = randomUUID();
  const plan = {
    campaign: {
      id: randomUUID(),
      name: "Ward A LIVE-MODE SYNTHETIC TEST",
      endDate: "2030-10-18",
    },
    event: {
      id: randomUUID(),
      name: "Paired field event",
      endDate: "2030-10-18",
    },
    sourceDigest: validated.preview.digest,
    pairs: Array.from({ length: 10 }, (_, i) => ({
      id: randomUUID(),
      label: `Pair ${String(i + 1).padStart(2, "0")}`,
      householdKeys: rows
        .slice(i * 10, i * 10 + 10)
        .map((r) => r["Household Key"]),
    })),
  };
  await assert.rejects(
    preloadLiveCampaign(runtime, plan, bytes, actor),
    /not been activated/,
  );
  await pool.query("UPDATE outreach.deployment SET stage='outreach-live'"); // Isolated test database only.

  // Failure on the final pair must roll back campaign, all residents and earlier pairs.
  await pool.query(
    "ALTER TABLE outreach.assignments ADD CONSTRAINT preload_late_failure CHECK(name<>'Pair 10') NOT VALID",
  );
  try {
    await assert.rejects(preloadLiveCampaign(runtime, plan, bytes, actor));
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.campaigns WHERE id=$1",
          [plan.campaign.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM outreach.import_people WHERE campaign_id=$1",
          [plan.campaign.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await pool.query(
      "ALTER TABLE outreach.assignments DROP CONSTRAINT preload_late_failure",
    );
  }
  const [first, retry] = await Promise.all([
    preloadLiveCampaign(runtime, plan, bytes, actor),
    preloadLiveCampaign(runtime, plan, bytes, actor),
  ]);
  assert.deepEqual(first, retry);
  assert.equal(first.campaign.name, plan.campaign.name);
  assert.equal(first.campaign.dataKind, "live");
  assert.equal(first.campaign.endAt, "2030-10-19T03:59:59.000Z");
  assert.equal(first.campaign.deletionAt, "2030-11-18T04:59:59.000Z");
  assert.deepEqual(first.receipt.counts, {
    people: 100,
    households: 100,
    buildings: 100,
  });
  assert.equal(first.pairs.length, 10);
  assert.equal(first.credentialsIssued, 0);
  assert.deepEqual(
    (
      await pool.query(
        "SELECT id,name,end_at,deletion_at FROM outreach.campaigns WHERE id<>$1 ORDER BY id",
        [plan.campaign.id],
      )
    ).rows,
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.campaigns WHERE data_kind='synthetic'",
      )
    ).rows[0].n,
    before.length,
  );
  const list = await listHostedCampaigns(runtime);
  assert.equal(
    list.find((c) => c.id === plan.campaign.id)?.importReceipt?.counts
      .households,
    100,
  );
  assert.equal(list.find((c) => c.id === plan.campaign.id)?.dataKind, "live");
  await assert.rejects(
    preloadLiveCampaign(
      runtime,
      {
        ...plan,
        pairs: plan.pairs.map((p, i) =>
          i ? p : { ...p, label: "Different pair" },
        ),
      },
      bytes,
      actor,
    ),
  );
  await assert.rejects(preloadLiveCampaign(runtime, plan, bytes, randomUUID()));
  await assert.rejects(
    pool.query("UPDATE outreach.deployment SET stage='synthetic-preview'"),
    { code: "JC004" },
  );
  await assert.rejects(reader.query("SELECT * FROM outreach.import_people"), {
    code: "42501",
  });
  await assert.rejects(
    reader.query("UPDATE outreach.deployment SET stage='synthetic-preview'"),
    { code: "42501" },
  );
  await verifyReader(runtime);

  const assignmentId = plan.pairs[0].id;
  const issued = await hostedFieldAdmin(
    runtime,
    {
      action: "issue",
      id: randomUUID(),
      assignmentId,
      label: "Synthetic test link",
    },
    actor,
  );
  const token = issued.token!;
  const download = await downloadHostedAssignment(runtime, token);
  assert.equal(download.synthetic, false);
  assert.equal(download.households.length, 10);
  assert.ok(download.programs.every((p) => p.reviewedAt === "2026-09-18"));
  assert.ok(!JSON.stringify(download).includes("sourceKey"));
  assert.ok(!JSON.stringify(download).includes("VANID"));
  const other = (
    await assignmentAdmin(
      runtime,
      { action: "workspace", campaignId: plan.campaign.id },
      actor,
    )
  ).workspace.assignments[1].householdIds[0];
  const operation: VisitOperation = {
    id: randomUUID(),
    schemaVersion: 1,
    kind: "visit",
    assignmentId,
    householdId: download.households[0].id,
    visitId: randomUUID(),
    createdAt: new Date().toISOString(),
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  };
  const receipt = await submitHostedOperation(runtime, token, operation);
  assert.deepEqual(
    await submitHostedOperation(runtime, token, operation),
    receipt,
  );
  await assert.rejects(
    submitHostedOperation(runtime, token, {
      ...operation,
      id: randomUUID(),
      visitId: randomUUID(),
      householdId: other,
    }),
  );
  assert.equal(
    (await hostedFieldAdmin(runtime, { action: "status", assignmentId }, actor))
      .snapshot.counts.attempts,
    1,
  );
  await pool.query(
    "UPDATE outreach.campaigns SET end_at=now()-interval '40 days',deletion_at=((now()-interval '40 days') AT TIME ZONE 'America/New_York'+interval '30 days') AT TIME ZONE 'America/New_York' WHERE id=$1",
    [plan.campaign.id],
  );
  await assert.rejects(downloadHostedAssignment(runtime, token));
  await pool.query("SELECT outreach.run_retention()");
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.campaigns WHERE id=$1",
        [plan.campaign.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM outreach.import_people WHERE campaign_id=$1",
        [plan.campaign.id],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(submitHostedOperation(runtime, token, operation));
  await verifyReader(runtime);
});
