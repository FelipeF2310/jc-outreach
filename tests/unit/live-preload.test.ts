import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { preloadLiveCampaign } from "../../src/server/live-preload";
import { isHostedStage } from "../../src/server/hosted-stage";
import { validateImport } from "../../src/server/import-validation";
import { rehearsalCsv } from "../../src/server/import-rehearsal";
import { outreachPrograms } from "../../src/server/program-reference";
import type { Database } from "../../src/server/db-contract";

test("preload rejects changed source, duplicate doors, invalid identity and split buildings before opening a transaction", async () => {
  let touched = false;
  const db: Database = {
    query: async () => {
      touched = true;
      throw Error();
    },
    exec: async () => {
      touched = true;
      throw Error();
    },
    transaction: async () => {
      touched = true;
      throw Error();
    },
  };
  const bytes = rehearsalCsv("valid-couple-and-buildings");
  const parsed = validateImport(bytes);
  const keys = [...new Set(parsed.rows.map((r) => r["Household Key"]))];
  const plan = {
    campaign: {
      id: randomUUID(),
      name: "Synthetic preload test",
      endDate: "2030-10-18",
    },
    event: { id: randomUUID(), name: "Synthetic event", endDate: "2030-10-18" },
    sourceDigest: parsed.preview.digest,
    pairs: [{ id: randomUUID(), label: "Pair 01", householdKeys: keys }],
  };
  const actor = randomUUID();
  await assert.rejects(
    preloadLiveCampaign(
      db,
      { ...plan, sourceDigest: "0".repeat(64) },
      bytes,
      actor,
    ),
    /source/,
  );
  await assert.rejects(
    preloadLiveCampaign(db, plan, bytes, "not-an-identity"),
    /plan/,
  );
  await assert.rejects(
    preloadLiveCampaign(
      db,
      {
        ...plan,
        pairs: [{ ...plan.pairs[0], householdKeys: [...keys, keys[0]] }],
      },
      bytes,
      actor,
    ),
    /exactly one/,
  );
  await assert.rejects(
    preloadLiveCampaign(
      db,
      {
        ...plan,
        pairs: keys.map((key, i) => ({
          id: randomUUID(),
          label: `Pair ${i}`,
          householdKeys: [key],
        })),
      },
      bytes,
      actor,
    ),
    /building/,
  );
  await assert.rejects(
    preloadLiveCampaign(
      db,
      { ...plan, event: { ...plan.event, endDate: "2030-10-19" } },
      bytes,
      actor,
    ),
    /within/,
  );
  assert.equal(touched, false);
});

test("live mode is explicit and reference content remains informational with reviewed official sources", () => {
  assert.equal(isHostedStage("outreach-live"), true);
  assert.equal(isHostedStage("synthetic-preview"), true);
  for (const value of [undefined, "production", "true", "", true])
    assert.equal(isHostedStage(value), false);
  const programs = outreachPrograms();
  assert.deepEqual(
    programs.map((p) => p.id),
    ["freeze", "stay", "anchor"],
  );
  for (const program of programs) {
    assert.equal(new URL(program.url).hostname, "www.nj.gov");
    assert.equal(program.reviewedAt, "2026-09-18");
    assert.ok(program.summary.length > 20);
  }
});
