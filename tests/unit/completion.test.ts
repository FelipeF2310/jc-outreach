import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createDatabase, seedSynthetic } from "../../src/server/database";
import {
  issueCredential,
  downloadAssignment,
  submitCompletion,
  submitOperation,
  results,
  hashToken,
} from "../../src/server/service";
import {
  completionReportSchema,
  type CompletionReport,
  type CompletionSnapshot,
} from "../../src/lib/completion-contracts";
import {
  DomainError,
  type Assignment,
  type VisitOperation,
} from "../../src/lib/contracts";
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
const denied = (status: number) => (error: unknown) =>
  error instanceof DomainError && error.status === status;
function report(extra: Partial<CompletionReport> = {}): CompletionReport {
  return {
    id: randomUUID(),
    assignmentId: assignment.id,
    deviceId: randomUUID(),
    version: 1,
    state: "finished",
    operationIds: [],
    pendingIds: [],
    createdAt: new Date().toISOString(),
    ...extra,
  };
}
function visit(): VisitOperation {
  return {
    id: randomUUID(),
    assignmentId: assignment.id,
    visitId: randomUUID(),
    householdId: assignment.households[0].id,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind: "visit",
    result: "no_answer",
    programs: [],
    help: null,
    corrections: [],
    doNotContact: false,
  };
}
async function snapshot() {
  return (
    await db.query<{ snapshot: CompletionSnapshot }>(
      "SELECT outreach.completion_snapshot($1) AS snapshot",
      [assignment.id],
    )
  ).rows[0].snapshot;
}
test("completion validates exact metadata, unique bounded manifests and pending subset", () => {
  const good = report();
  assert.equal(completionReportSchema.safeParse(good).success, true);
  for (const bad of [
    { ...good, ownerName: "fixture" },
    { ...good, pendingIds: [randomUUID()] },
    { ...good, operationIds: [good.id, good.id] },
    { ...good, state: null },
    { ...good, version: 0 },
    { ...good, operationIds: Array.from({ length: 2001 }, () => randomUUID()) },
  ])
    assert.equal(completionReportSchema.safeParse(bad).success, false);
});
test("completion waits for declared records, retries identically and never manufactures visits", async () => {
  assert.equal(assignment.completionReady, true);
  const op = visit(),
    r = report({ operationIds: [op.id], pendingIds: [op.id] });
  const before = (await results(db)).counts;
  const receipt = await submitCompletion(db, token, r);
  assert.deepEqual(await submitCompletion(db, token, r), receipt);
  assert.deepEqual((await results(db)).counts, before);
  assert.equal(
    (await snapshot()).devices.find((d) => d.deviceId === r.deviceId)!
      .missingCount,
    1,
  );
  await submitOperation(db, token, op);
  const received = (await snapshot()).devices.find(
    (d) => d.deviceId === r.deviceId,
  )!;
  assert.equal(received.missingCount, 0);
  assert.equal(received.additionalActivity, false);
  assert.equal(
    received.pendingReportedCount,
    1,
    "last-reported pending count stays historical even after actual receipt",
  );
  await assert.rejects(
    submitCompletion(db, token, { ...r, state: "working" }),
    denied(409),
  );
});
test("new manifests invalidate completion; delayed versions cannot replace a newer resume report", async () => {
  const op = visit(),
    r = report();
  await submitCompletion(db, token, r);
  const next = {
    ...r,
    id: randomUUID(),
    version: 3,
    operationIds: [op.id],
    pendingIds: [op.id],
  };
  await submitCompletion(db, token, next);
  assert.equal(
    (await snapshot()).devices.find((d) => d.deviceId === r.deviceId)!
      .missingCount,
    1,
  );
  await submitCompletion(db, token, { ...r, id: randomUUID(), version: 2 });
  assert.equal(
    (await snapshot()).devices.find((d) => d.deviceId === r.deviceId)!.version,
    3,
  );
  await assert.rejects(
    submitCompletion(db, token, { ...r, id: randomUUID(), version: 4 }),
    denied(409),
  );
  await submitOperation(db, token, op);
  await submitCompletion(db, token, {
    ...next,
    id: randomUUID(),
    version: 4,
    state: "working",
    pendingIds: [],
  });
  assert.equal(
    (await snapshot()).devices.find((d) => d.deviceId === r.deviceId)!.state,
    "working",
  );
});
test("another browser stays separate and unreported legacy activity prevents false certainty", async () => {
  const a = report(),
    b = report({ state: "working" });
  await submitCompletion(db, token, a);
  await submitCompletion(db, token, b);
  const unreported = visit();
  await submitOperation(db, token, unreported);
  assert.equal(
    (await snapshot()).devices.find((d) => d.deviceId === a.deviceId)!
      .additionalActivity,
    true,
  );
  await submitCompletion(db, token, {
    ...b,
    id: randomUUID(),
    version: 2,
    operationIds: [unreported.id],
  });
  const devices = (await snapshot()).devices;
  assert.equal(
    devices.find((d) => d.deviceId === a.deviceId)!.additionalActivity,
    false,
  );
  assert.equal(
    devices.find((d) => d.deviceId === b.deviceId)!.state,
    "working",
  );
});
test("scope, revocation, upload-window and campaign expiration also govern completion", async () => {
  const r = report();
  await assert.rejects(
    submitCompletion(db, token, { ...r, assignmentId: randomUUID() }),
    denied(403),
  );
  const revoked = await issueCredential(db, assignment.id);
  await submitCompletion(db, revoked, r);
  await db.query(
    "UPDATE outreach.credentials SET revoked=true WHERE token_hash=$1",
    [hashToken(revoked)],
  );
  await assert.rejects(submitCompletion(db, revoked, r), denied(403));
  const end = Date.parse(assignment.eventEndsAt);
  await submitCompletion(db, token, report(), new Date(end + 3600000));
  await assert.rejects(
    submitCompletion(db, token, report(), new Date(end + 72 * 3600000)),
    denied(410),
  );
  await assert.rejects(
    submitCompletion(db, token, report(), new Date(assignment.deletionAt)),
    denied(410),
  );
});
