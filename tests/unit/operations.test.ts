import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, seedSynthetic } from "../../src/server/database";
import {
  downloadAssignment,
  hashToken,
  issueCredential,
  results,
  submitOperation,
} from "../../src/server/service";
import {
  DomainError,
  operationSchema,
  type Assignment,
  type Operation,
  type VisitOperation,
} from "../../src/lib/contracts";
import { requireDemo } from "../../src/server/http";

let db: PGlite, assignment: Assignment, token: string;
before(async () => {
  db = await createDatabase();
  const id = await seedSynthetic(db);
  token = await issueCredential(db, id);
  assignment = await downloadAssignment(db, token);
});
after(async () => {
  await db?.close();
});
function visit(extra: Partial<VisitOperation> = {}): VisitOperation {
  return {
    id: randomUUID(),
    visitId: randomUUID(),
    assignmentId: assignment.id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: "visit",
    householdId: assignment.households[0].id,
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
    ...extra,
  };
}
const status = (code: number) => (error: unknown) =>
  error instanceof DomainError && error.status === code;

test("fixture grouping returns three doors with nested people and no source matching fields", () => {
  assert.equal(assignment.households.length, 3);
  assert.equal(assignment.households[0].people.length, 2);
  assert.deepEqual(
    Object.keys(assignment.households[0]).sort(),
    ["id", "buildingId", "address", "unit", "suppressed", "people"].sort(),
  );
  const json = JSON.stringify(assignment);
  for (const field of [
    "Score",
    "Owner of Record",
    "VANID",
    "Tier",
    "Match Rationale",
    "SYNTHETIC OWNER",
  ])
    assert.ok(!json.includes(field));
});
test("identical concurrent retries produce one visit and the same acknowledgment", async () => {
  const op = visit();
  const before = await results(db);
  const receipts = await Promise.all([
    submitOperation(db, token, op),
    submitOperation(db, token, op),
  ]);
  assert.deepEqual(receipts[0], receipts[1]);
  assert.equal((await results(db)).visits.length, before.visits.length + 1);
  await assert.rejects(
    submitOperation(db, token, { ...op, result: "resident" }),
    status(409),
  );
});
test("separate real visits are not overwritten", async () => {
  const before = (await results(db)).visits.length;
  await submitOperation(db, token, visit());
  await submitOperation(db, token, visit());
  assert.equal((await results(db)).visits.length, before + 2);
});
test("help without a phone commits with the visit", async () => {
  const op = visit({
    result: "resident",
    help: {
      id: randomUUID(),
      personId: null,
      phone: "",
      consent: false,
      arrangement: "return",
    },
  });
  await submitOperation(db, token, op);
  const row = await db.query(
    "SELECT * FROM outreach.help_requests WHERE id=$1",
    [op.help!.id],
  );
  assert.equal(row.rows.length, 1);
});
test("phone without consent and unexpected fields reject before persistence", async () => {
  const op = visit({
    help: {
      id: randomUUID(),
      personId: null,
      phone: "555-0100",
      consent: false,
      arrangement: "return",
    },
  });
  assert.equal(operationSchema.safeParse(op).success, false);
  await assert.rejects(submitOperation(db, token, op), status(422));
  await assert.rejects(
    submitOperation(db, token, { ...visit(), ownerScore: 150 }),
    status(422),
  );
  assert.equal(
    (await db.query("SELECT id FROM outreach.operations WHERE id=$1", [op.id]))
      .rows.length,
    0,
  );
});
test("failure of a child insert rolls back the entire operation", async () => {
  const helpId = randomUUID();
  const first = visit({
    help: {
      id: helpId,
      personId: null,
      phone: "",
      consent: false,
      arrangement: "unspecified",
    },
  });
  await submitOperation(db, token, first);
  // Duplicate child ID provokes a real PostgreSQL constraint failure after visit insertion.
  const broken = visit({ help: first.help });
  await assert.rejects(submitOperation(db, token, broken));
  assert.equal(
    (
      await db.query("SELECT id FROM outreach.operations WHERE id=$1", [
        broken.id,
      ])
    ).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query("SELECT id FROM outreach.visits WHERE id=$1", [
        broken.visitId,
      ])
    ).rows.length,
    0,
  );
});
test("revision after a lost receipt preserves child identity and administrator state", async () => {
  const original = visit({
    help: {
      id: randomUUID(),
      personId: null,
      phone: "",
      consent: false,
      arrangement: "return",
    },
  });
  await submitOperation(db, token, original);
  await db.query(
    "UPDATE outreach.help_requests SET status='Resolved' WHERE id=$1",
    [original.help!.id],
  );
  const before = (await results(db)).visits.length;
  const revision: Operation = {
    id: randomUUID(),
    kind: "revision",
    assignmentId: assignment.id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    visitId: original.visitId,
    householdId: original.householdId,
    originalOperationId: original.id,
    previousOperationId: original.id,
    result: "resident",
  };
  await submitOperation(db, token, original);
  await submitOperation(db, token, revision);
  await submitOperation(db, token, revision);
  assert.equal((await results(db)).visits.length, before);
  assert.equal(
    (
      await db.query<{ status: string }>(
        "SELECT status FROM outreach.help_requests WHERE id=$1",
        [original.help!.id],
      )
    ).rows[0].status,
    "Resolved",
  );
  await assert.rejects(
    submitOperation(db, token, {
      ...revision,
      id: randomUUID(),
      result: "other",
    }),
    status(409),
  );
});
test("a missing original visit is a dependency error, not a successful revision", async () => {
  const original = visit();
  await assert.rejects(
    submitOperation(db, token, {
      id: randomUUID(),
      kind: "revision",
      assignmentId: assignment.id,
      schemaVersion: 1,
      createdAt: original.createdAt,
      visitId: original.visitId,
      householdId: original.householdId,
      originalOperationId: original.id,
      previousOperationId: original.id,
      result: "resident",
    }),
    status(424),
  );
});
test("building access failure creates zero household visits and retries safely", async () => {
  const before = await results(db);
  const op: Operation = {
    id: randomUUID(),
    kind: "building",
    assignmentId: assignment.id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    buildingId: assignment.households[0].buildingId,
    reason: "locked",
  };
  await submitOperation(db, token, op);
  await submitOperation(db, token, op);
  const after = await results(db);
  assert.equal(after.visits.length, before.visits.length);
  assert.equal(after.counts.buildings, before.counts.buildings + 1);
});
test("unrelated household, building, assignment and person IDs reject", async () => {
  await assert.rejects(
    submitOperation(db, token, visit({ householdId: randomUUID() })),
    status(403),
  );
  await assert.rejects(
    submitOperation(db, token, visit({ assignmentId: randomUUID() })),
    status(403),
  );
  await assert.rejects(
    submitOperation(db, token, {
      id: randomUUID(),
      kind: "building",
      assignmentId: assignment.id,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      buildingId: randomUUID(),
      reason: "locked",
    }),
    status(403),
  );
  await assert.rejects(
    submitOperation(
      db,
      token,
      visit({
        corrections: [
          {
            id: randomUUID(),
            personId: assignment.households[2].people[0].id,
            kind: "moved",
          },
        ],
      }),
    ),
    status(403),
  );
});
test("person correction remains a report and DNC is sticky across contact revisions", async () => {
  const person = assignment.households[0].people[0];
  const op = visit({
    doNotContact: true,
    corrections: [{ id: randomUUID(), kind: "moved", personId: person.id }],
  });
  await submitOperation(db, token, op);
  const updated = await downloadAssignment(db, token);
  assert.equal(updated.households[0].suppressed, true);
  assert.deepEqual(
    updated.households[0].people,
    assignment.households[0].people,
  );
});
test("upload-only window permits old work but not downloads or new field work", async () => {
  const end = new Date(assignment.eventEndsAt);
  await assert.rejects(downloadAssignment(db, token, end), status(403));
  await submitOperation(db, token, visit(), new Date(end.getTime() + 3600000));
  await assert.rejects(
    submitOperation(db, token, visit({ createdAt: end.toISOString() }), end),
    status(422),
  );
  await assert.rejects(
    submitOperation(db, token, visit(), new Date(end.getTime() + 72 * 3600000)),
    status(410),
  );
});
test("revocation rejects download and upload including previously acknowledged retries", async () => {
  const revoked = await issueCredential(db, assignment.id);
  const op = visit();
  await submitOperation(db, revoked, op);
  await db.query(
    "UPDATE outreach.credentials SET revoked=true WHERE token_hash=$1",
    [hashToken(revoked)],
  );
  await assert.rejects(downloadAssignment(db, revoked), status(403));
  await assert.rejects(submitOperation(db, revoked, op), status(403));
});
test("campaign expiration rejects an old upload even before deletion executes", async () => {
  await assert.rejects(
    submitOperation(db, token, visit(), new Date(assignment.deletionAt)),
    status(410),
  );
});
test("demo is explicit, loopback-only and cannot silently become production authorization", () => {
  const previous = process.env.JCO_SYNTHETIC_ONLY;
  try {
    delete process.env.JCO_SYNTHETIC_ONLY;
    assert.throws(
      () => requireDemo(new Request("http://localhost/api/demo")),
      status(503),
    );
    process.env.JCO_SYNTHETIC_ONLY = "1";
    assert.doesNotThrow(() =>
      requireDemo(
        new Request("http://localhost:3100/api/demo", {
          headers: {
            host: "127.0.0.1:3100",
            origin: "http://127.0.0.1:3100",
            "x-jco-demo": "1",
          },
        }),
        true,
      ),
    );
    assert.throws(
      () => requireDemo(new Request("https://example.com/api/demo")),
      status(503),
    );
    assert.throws(
      () => requireDemo(new Request("http://localhost/api/demo"), true),
      status(403),
    );
    assert.throws(
      () =>
        requireDemo(
          new Request("http://localhost/api/demo", {
            headers: { origin: "https://example.com", "x-jco-demo": "1" },
          }),
          true,
        ),
      status(403),
    );
  } finally {
    if (previous === undefined) delete process.env.JCO_SYNTHETIC_ONLY;
    else process.env.JCO_SYNTHETIC_ONLY = previous;
  }
});
