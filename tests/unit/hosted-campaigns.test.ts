import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHostedCampaign } from "../../src/server/hosted-campaigns";
import type { Database } from "../../src/server/db-contract";

test("campaign validation rejects unknown authority fields and invalid dates before querying", async () => {
  let queries = 0;
  const db: Database = {
    async query() {
      queries++;
      return { rows: [] };
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  const valid = { id: randomUUID(), name: "Practice", endDate: "2030-04-01" };
  for (const input of [
    { ...valid, name: " " },
    { ...valid, name: "a\nb" },
    { ...valid, endDate: "2030-02-30" },
    { ...valid, endDate: "2030-03-01T12:00Z" },
    { ...valid, deletionAt: "2090-01-01" },
    { ...valid, createdBy: randomUUID() },
    { ...valid, id: "bad" },
  ])
    await assert.rejects(
      () => createHostedCampaign(db, input, randomUUID()),
      /valid end date/,
    );
  assert.equal(queries, 0);
});

test("campaign creation without the additive migration gives an actionable setup error", async () => {
  const db: Database = {
    async query() {
      throw Object.assign(new Error("private database details"), {
        code: "42883",
      });
    },
    async exec() {},
    async transaction(work) {
      return work(db);
    },
  };
  await assert.rejects(
    () =>
      createHostedCampaign(
        db,
        { id: randomUUID(), name: "Practice", endDate: "2030-04-01" },
        randomUUID(),
      ),
    /needs its database update/,
  );
});
