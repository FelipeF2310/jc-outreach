import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import fixture from "../fixtures/outreach.json";
import cases from "../fixtures/import-cases.json";
import {
  sourceHeaders,
  persistedHeaders,
} from "../../src/lib/import-contracts";
import { DomainError } from "../../src/lib/contracts";
import {
  validateImport,
  IMPORT_LIMITS,
} from "../../src/server/import-validation";
import { finalizeImport } from "../../src/server/import-service";
import {
  assignRehearsal,
  createRehearsal,
  rehearsalCsv,
  rehearsalRequest,
} from "../../src/server/import-rehearsal";
import { createDatabase, seedSynthetic } from "../../src/server/database";
import {
  downloadAssignment,
  issueCredential,
  submitOperation,
} from "../../src/server/service";
import { migrate } from "../../src/server/migrate";

let db: PGlite;
before(async () => {
  db = await createDatabase();
});
after(async () => {
  await db.close();
});
const validBytes = () => rehearsalCsv("valid-couple-and-buildings");
const status = (code: number) => (error: unknown) =>
  error instanceof DomainError && error.status === code;
const campaign = async () =>
  (await createRehearsal(db, randomUUID())).campaignId;
const csv = (
  rows: Record<string, string>[],
  headers: readonly string[] = sourceHeaders,
) =>
  new TextEncoder().encode(
    [headers, ...rows.map((row) => headers.map((h) => row[h]))]
      .map((record) =>
        record.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\r\n"),
  );
const clone = (): Record<string, string>[] => structuredClone(fixture.records);
async function counts(id: string) {
  return (
    await db.query<{
      imports: number;
      people: number;
      households: number;
      buildings: number;
    }>(
      `SELECT
    (SELECT count(*)::int FROM outreach.imports WHERE campaign_id=$1) AS imports,
    (SELECT count(*)::int FROM outreach.people p JOIN outreach.households h ON h.id=p.household_id WHERE h.campaign_id=$1) AS people,
    (SELECT count(*)::int FROM outreach.households WHERE campaign_id=$1) AS households,
    (SELECT count(*)::int FROM outreach.buildings WHERE campaign_id=$1) AS buildings`,
      [id],
    )
  ).rows[0];
}
const empty = { imports: 0, people: 0, households: 0, buildings: 0 };

test("valid CSV preview groups couples, preserves text IDs and returns only the persistence allowlist", () => {
  const parsed = validateImport(validBytes());
  assert.equal(parsed.preview.valid, true);
  assert.deepEqual(parsed.preview.counts, fixture.expectedCounts);
  assert.equal(parsed.preview.households[0].people.length, 2);
  assert.equal(parsed.rows[0].VANID, "00000001");
  assert.equal(parsed.rows[0].Zip, "07304");
  assert.equal(parsed.rows[0].Block, "00001");
  assert.equal(parsed.rows[0].Lot, "01");
  assert.deepEqual(
    Object.keys(parsed.rows[0]).sort(),
    [...persistedHeaders].sort(),
  );
  for (const marker of ["SYNTHETIC OWNER", "Match Rationale", "Score", '"Age"'])
    assert.ok(!JSON.stringify(parsed).includes(marker));
});

for (const example of cases.cases.filter(
  (c) => c.id !== "valid-couple-and-buildings",
)) {
  test(`reject ${example.id} with no source values in diagnostics and zero committed rows`, async () => {
    const id = await campaign();
    const bytes = rehearsalCsv(example.id);
    const parsed = validateImport(bytes);
    assert.equal(parsed.preview.valid, false);
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.preview.households, []);
    assert.equal(parsed.preview.digest, null);
    for (const marker of [
      "Resident A",
      "Resident B",
      "Fixture",
      "SYNTHETIC OWNER",
      "Unexpected Test Column",
    ])
      assert.ok(!JSON.stringify(parsed).includes(marker));
    await assert.rejects(
      finalizeImport(db, id, bytes, "0".repeat(64)),
      status(422),
    );
    assert.deepEqual(await counts(id), empty);
  });
}
test("CSV accepts BOM, reordered known headers, accents, escaped quotes and commas", () => {
  const rows = clone();
  rows[0]["First Name"] = 'Rósa, "Practice"';
  rows[0]["Match Rationale"] = "Discarded\nmultiline content";
  const bytes = csv(rows, [...sourceHeaders].reverse());
  const bom = new Uint8Array([239, 187, 191, ...bytes]);
  const parsed = validateImport(bom);
  assert.equal(parsed.preview.valid, true);
  assert.equal(parsed.rows[0]["First Name"], 'Rósa, "Practice"');
});
test("approved export rationale spelling validates and finalizes without retaining discarded values", async () => {
  const rows = clone();
  for (const row of rows) row.Rationale = "DISCARDED EXPORT REASON";
  const headers = sourceHeaders.map((header) =>
    header === "Match Rationale" ? "Rationale" : header,
  );
  const bytes = csv(rows, [...headers].reverse());
  const parsed = validateImport(bytes);
  assert.equal(parsed.preview.valid, true);
  assert.deepEqual(parsed.rows, validateImport(validBytes()).rows);
  assert.deepEqual(parsed.preview.counts, fixture.expectedCounts);
  assert.ok(!JSON.stringify(parsed).includes("DISCARDED EXPORT REASON"));
  assert.notEqual(
    parsed.preview.digest,
    validateImport(validBytes()).preview.digest,
  );
  const id = await campaign();
  const receipt = await finalizeImport(db, id, bytes, parsed.preview.digest!);
  assert.deepEqual(receipt.counts, fixture.expectedCounts);
  const stored = await db.query(
    "SELECT row_to_json(s) AS source FROM outreach.import_people s WHERE campaign_id=$1",
    [id],
  );
  assert.equal(stored.rows.length, 4);
  assert.ok(!JSON.stringify(stored.rows).includes("DISCARDED EXPORT REASON"));
});
test("rationale alias keeps duplicate-header and whole-file Tier rejection intact", async () => {
  const rows = clone();
  for (const row of rows) row.Rationale = "DISCARDED EXPORT REASON";
  const aliasHeaders = sourceHeaders.map((header) =>
    header === "Match Rationale" ? "Rationale" : header,
  );
  for (const headers of [
    [...sourceHeaders, "Rationale"],
    sourceHeaders.map((header) => (header === "Age" ? "Rationale" : header)),
  ]) {
    const result = validateImport(csv(rows, headers));
    assert.equal(result.preview.issues[0].code, "headers");
    assert.deepEqual(result.rows, []);
  }
  for (const tier of ["3", "", "1.0", "unknown"]) {
    rows[1].Tier = tier;
    const bytes = csv(rows, aliasHeaders);
    const parsed = validateImport(bytes);
    assert.equal(parsed.preview.issues[0].code, "tier");
    assert.deepEqual(parsed.rows, []);
    assert.deepEqual(parsed.preview.households, []);
    assert.ok(!JSON.stringify(parsed).includes("DISCARDED EXPORT REASON"));
    const id = await campaign();
    await assert.rejects(
      finalizeImport(db, id, bytes, "0".repeat(64)),
      status(422),
    );
    assert.deepEqual(await counts(id), empty);
  }
});
test("malformed CSV, invalid UTF-8, repeated headers and unsupported sizes reject without leaking parser errors", () => {
  const duplicated = [...sourceHeaders];
  duplicated[0] = "Last Name";
  for (const bytes of [
    new Uint8Array([0xff, 0xfe, 0xff]),
    csv(clone(), duplicated),
    new TextEncoder().encode('"Private malformed resident'),
    new Uint8Array(0),
    new Uint8Array(IMPORT_LIMITS.bytes + 1),
  ]) {
    const parsed = validateImport(bytes);
    assert.equal(parsed.preview.valid, false);
    assert.deepEqual(parsed.rows, []);
    assert.ok(!JSON.stringify(parsed).includes("Private malformed"));
  }
  const tooMany = Array.from(
    { length: IMPORT_LIMITS.rows + 1 },
    () => fixture.records[0],
  );
  assert.equal(
    validateImport(csv(tooMany)).preview.issues[0].code,
    "row_count",
  );
});
test("different source keys cannot create the same door; ambiguous blank units are blocked", () => {
  const rows = clone();
  rows[1]["Household Key"] = "00001-01-CNEW";
  rows[1].Qual = "CNEW";
  assert.ok(
    validateImport(csv(rows)).preview.issues.some(
      (i) => i.code === "duplicate_door",
    ),
  );
  const missing = clone();
  missing[2]["Unit (verified)"] = "";
  missing[2]["Residence Address"] = "100 Fixture Walk";
  assert.ok(
    validateImport(csv(missing)).preview.issues.some(
      (i) => i.code === "missing_unit",
    ),
  );
});
test("key, declared count, ZIP and Ward contradictions are flagged rather than guessed", () => {
  for (const [field, value, code] of [
    ["Household Key", "wrong", "household_key"],
    ["Persons in Household", "3", "household_count"],
    ["Zip", "7304", "location"],
    ["Ward", "Z", "location"],
  ]) {
    const rows = clone();
    rows[0][field] = value;
    assert.ok(
      validateImport(csv(rows)).preview.issues.some((i) => i.code === code),
    );
  }
});
test("repeated previews do not persist; identical concurrent finalizations produce one receipt", async () => {
  const id = await campaign(),
    bytes = validBytes();
  const first = validateImport(bytes).preview;
  validateImport(bytes);
  assert.deepEqual(await counts(id), empty);
  const [a, b] = await Promise.all([
    finalizeImport(db, id, bytes, first.digest!),
    finalizeImport(db, id, bytes, first.digest!),
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(await counts(id), {
    imports: 1,
    people: 4,
    households: 3,
    buildings: 2,
  });
  const source = await db.query<Record<string, string>>(
    "SELECT * FROM outreach.import_people WHERE campaign_id=$1 ORDER BY source_id",
    [id],
  );
  assert.equal(source.rows[0].source_id, "00000001");
  assert.equal(source.rows[0].zip, "07304");
  assert.equal(source.rows[0].block, "00001");
  const all = await db.query(
    "SELECT row_to_json(p) AS person, row_to_json(s) AS source FROM outreach.people p JOIN outreach.import_people s ON s.person_id=p.id WHERE s.campaign_id=$1",
    [id],
  );
  for (const marker of ["SYNTHETIC OWNER", "Match Rationale", "Score", '"Age"'])
    assert.ok(!JSON.stringify(all.rows).includes(marker));
});
test("changed source after preview rejects, and a finalized dataset cannot be replaced even before assignments", async () => {
  const id = await campaign(),
    bytes = validBytes(),
    digest = validateImport(bytes).preview.digest!;
  const rows = clone();
  rows[3]["First Name"] = "Changed synthetic name";
  const different = csv(rows);
  await assert.rejects(finalizeImport(db, id, different, digest), status(409));
  assert.deepEqual(await counts(id), empty);
  await finalizeImport(db, id, bytes, digest);
  await assert.rejects(
    finalizeImport(
      db,
      id,
      different,
      validateImport(different).preview.digest!,
    ),
    status(409),
  );
  assert.deepEqual(await counts(id), {
    imports: 1,
    people: 4,
    households: 3,
    buildings: 2,
  });
});
test("an actual middle-of-import constraint failure rolls back import receipt, buildings, households and people", async () => {
  const id = await campaign(),
    bytes = validBytes(),
    digest = validateImport(bytes).preview.digest!;
  await db.exec(
    "ALTER TABLE outreach.import_people ADD CONSTRAINT synthetic_failure CHECK(source_id <> '00000003') NOT VALID",
  );
  try {
    await assert.rejects(finalizeImport(db, id, bytes, digest));
    assert.deepEqual(await counts(id), empty);
  } finally {
    await db.exec(
      "ALTER TABLE outreach.import_people DROP CONSTRAINT synthetic_failure",
    );
  }
  await finalizeImport(db, id, bytes, digest);
  assert.equal((await counts(id)).people, 4);
});
test("expired/missing campaigns and legacy populated campaigns reject import", async () => {
  const bytes = validBytes(),
    digest = validateImport(bytes).preview.digest!;
  await assert.rejects(
    finalizeImport(db, randomUUID(), bytes, digest),
    status(404),
  );
  const id = await campaign();
  await db.query(
    "UPDATE outreach.campaigns SET deletion_at=now()-interval '1 second' WHERE id=$1",
    [id],
  );
  await assert.rejects(finalizeImport(db, id, bytes, digest), status(410));
  const assignment = await seedSynthetic(db);
  const row = await db.query<{ campaign_id: string }>(
    "SELECT campaign_id FROM outreach.assignments WHERE id=$1",
    [assignment],
  );
  await assert.rejects(
    finalizeImport(db, row.rows[0].campaign_id, bytes, digest),
    status(409),
  );
});
test("finalized import creates one repeatable assignment and reaches the existing volunteer submit path", async () => {
  const id = await campaign(),
    bytes = validBytes();
  await assert.rejects(assignRehearsal(db, id), status(409));
  await finalizeImport(db, id, bytes, validateImport(bytes).preview.digest!);
  const a = await assignRehearsal(db, id),
    b = await assignRehearsal(db, id);
  assert.equal(a.assignmentId, b.assignmentId);
  const downloaded = await downloadAssignment(db, a.token);
  assert.equal(downloaded.households.length, 3);
  assert.deepEqual(
    downloaded.households.slice(0, 2).map((h) => h.unit),
    ["2A", "10B"],
  );
  assert.equal(downloaded.households[0].people.length, 2);
  assert.ok(!JSON.stringify(downloaded).includes("source_id"));
  assert.ok(!JSON.stringify(downloaded).includes("00000001"));
  await submitOperation(db, a.token, {
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: a.assignmentId,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: "visit",
    householdId: downloaded.households[0].id,
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  });
  assert.equal(
    (
      await db.query("SELECT id FROM outreach.visits WHERE household_id=$1", [
        downloaded.households[0].id,
      ])
    ).rows.length,
    1,
  );
  await finalizeImport(db, id, bytes, validateImport(bytes).preview.digest!);
  assert.equal((await counts(id)).people, 4);
});
test("rehearsal endpoint contract refuses raw file bodies, rows, approval bypasses and extra fields", () => {
  for (const extra of [
    { csv: "unapproved data" },
    { rows: fixture.records },
    { valid: true },
    { filename: "exclusion.csv" },
  ])
    assert.equal(
      rehearsalRequest.safeParse({
        action: "preview",
        campaignId: randomUUID(),
        caseId: "valid-couple-and-buildings",
        ...extra,
      }).success,
      false,
    );
});
test("New York 30-calendar-day deadline preserves local hour across both DST changes", async () => {
  for (const [end, expected] of [
    ["2026-03-01T17:00:00Z", "2026-03-31T16:00:00.000Z"],
    ["2026-10-15T16:00:00Z", "2026-11-14T17:00:00.000Z"],
  ]) {
    const result = await db.query<{ deadline: Date }>(
      "SELECT (($1::timestamptz AT TIME ZONE 'America/New_York') + interval '30 days') AT TIME ZONE 'America/New_York' AS deadline",
      [end],
    );
    assert.equal(result.rows[0].deadline.toISOString(), expected);
  }
});
test("additive migration preserves an existing v1 walk and received visit; replay is a no-op", async () => {
  const legacy = await PGlite.create();
  try {
    await legacy.exec(await readFile("src/server/schema.sql", "utf8"));
    const assignment = await seedSynthetic(legacy),
      token = await issueCredential(legacy, assignment);
    const before = await downloadAssignment(legacy, token);
    const op = {
      id: randomUUID(),
      visitId: randomUUID(),
      assignmentId: assignment,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      kind: "visit",
      householdId: before.households[0].id,
      result: "no_answer",
      programs: [],
      help: null,
      corrections: [],
      doNotContact: false,
    };
    await submitOperation(legacy, token, op);
    await migrate(legacy);
    await migrate(legacy);
    assert.deepEqual(await downloadAssignment(legacy, token), before);
    assert.equal(
      (
        await legacy.query("SELECT id FROM outreach.visits WHERE id=$1", [
          op.visitId,
        ])
      ).rows.length,
      1,
    );
    assert.equal(
      (await legacy.query("SELECT * FROM outreach.schema_migrations")).rows
        .length,
      1,
    );
    await legacy.query(
      "UPDATE outreach.schema_migrations SET checksum='changed'",
    );
    await assert.rejects(migrate(legacy), /checksum changed/);
  } finally {
    await legacy.close();
  }
});
