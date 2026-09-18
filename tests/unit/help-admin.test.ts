import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpAdmin } from "../../src/server/admin-help";
import { DomainError } from "../../src/lib/contracts";
import type { Database } from "../../src/server/db-contract";

test("help status requests reject client authority, unsupported fields, states and versions before querying", async () => {
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
    action: "update",
    id,
    campaignId: id,
    requestId: id,
    expectedVersion: 0,
    status: "In progress",
  };
  for (const value of [
    { ...valid, actor: id },
    { ...valid, phone: "201-555-0100" },
    { ...valid, status: "New" },
    { ...valid, status: "ineligible" },
    { ...valid, expectedVersion: -1 },
    { ...valid, expectedVersion: 0.5 },
    { ...valid, requestId: "bad" },
    { action: "list", campaignId: id, rows: [] },
  ])
    await assert.rejects(
      () => helpAdmin(db, value, id),
      (e) => e instanceof DomainError && e.status === 400,
    );
  assert.equal(calls, 0);
});
