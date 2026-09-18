import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assignmentAdmin } from "../../src/server/assignment-admin";
import { DomainError } from "../../src/lib/contracts";
import type { Database } from "../../src/server/db-contract";

test("reassignment requires explicit confirmation, unique scoped IDs and no client actor or authority", async () => {
  let calls = 0;
  const db: Database = {
    query: async () => {
      calls++;
      throw Error();
    },
    exec: async () => {
      calls++;
    },
    transaction: async () => {
      calls++;
      throw Error();
    },
  };
  const id = randomUUID();
  const valid = {
    action: "reassign",
    id,
    campaignId: id,
    sourceId: id,
    name: "Practice B",
    householdIds: [id],
    confirmed: true,
  };
  for (const input of [
    { ...valid, confirmed: false },
    { ...valid, actor: id },
    { ...valid, targetId: id },
    { ...valid, householdIds: [] },
    { ...valid, householdIds: [id, id] },
    { ...valid, sourceId: "bad" },
    { ...valid, name: "" },
    { ...valid, name: "bad\nname" },
    { ...valid, rawRows: [] },
  ])
    await assert.rejects(
      () => assignmentAdmin(db, input, id),
      (e) => e instanceof DomainError && e.status === 400,
    );
  assert.equal(calls, 0);
});
