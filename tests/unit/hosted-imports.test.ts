import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hostedImport } from "../../src/server/hosted-imports";
import type { Database } from "../../src/server/db-contract";

test("hosted import contract rejects raw rows, arbitrary authority and missing confirmation before database access", async () => {
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
  const valid = {
    action: "preview",
    campaignId: randomUUID(),
    caseId: "valid-couple-and-buildings",
  };
  for (const input of [
    { ...valid, rows: [] },
    { ...valid, csv: "raw" },
    { ...valid, actor: randomUUID() },
    { ...valid, action: "finalize", digest: "0".repeat(64) },
    { ...valid, action: "finalize", digest: "0".repeat(64), confirmed: false },
    { ...valid, campaignId: "bad" },
  ])
    await assert.rejects(
      () => hostedImport(db, input, randomUUID()),
      /Only built-in/,
    );
  assert.equal(touched, false);
  await assert.rejects(
    () => hostedImport(db, { ...valid, caseId: "unknown-file" }, randomUUID()),
    /Unknown synthetic/,
  );
  assert.equal(touched, false);
});
