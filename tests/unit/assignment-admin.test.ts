import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assignmentAdmin } from "../../src/server/assignment-admin";
import type { Database } from "../../src/server/db-contract";

test("assignment preparation rejects forged authority, duplicate doors and raw data before querying", async () => {
  let touched = false;
  const db: Database = {
    async query() {
      touched = true;
      return { rows: [] };
    },
    async exec() {
      touched = true;
    },
    async transaction(work) {
      touched = true;
      return work(db);
    },
  };
  const id = randomUUID(),
    actor = randomUUID();
  const assignment = {
    action: "assignment",
    id,
    campaignId: randomUUID(),
    eventId: randomUUID(),
    name: "Practice",
    kind: "scattered",
    householdIds: [randomUUID()],
  };
  for (const input of [
    { ...assignment, createdBy: actor },
    { ...assignment, households: [{}] },
    { ...assignment, token: "supplied" },
    { ...assignment, householdIds: [] },
    { ...assignment, householdIds: [id, id] },
    { ...assignment, kind: "optimized" },
    { ...assignment, name: " " },
    {
      ...assignment,
      householdIds: Array.from({ length: 1001 }, () => randomUUID()),
    },
    {
      action: "event",
      id,
      campaignId: randomUUID(),
      name: "Practice",
      endDate: "2030-02-30",
    },
  ])
    await assert.rejects(
      () => assignmentAdmin(db, input, actor),
      /Choose a campaign/,
    );
  assert.equal(touched, false);
});
