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
import { verifyReader } from "../../src/server/verify-reader";
import { migrateCampaigns } from "../../src/server/migrate-campaigns";
import { migrateImports } from "../../src/server/migrate-imports";
import { hostedImport } from "../../src/server/hosted-imports";
import { createHostedCampaign } from "../../src/server/hosted-campaigns";
import { ownerPreflight } from "../../src/server/owner-preflight";
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
