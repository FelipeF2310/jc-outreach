import { test } from "node:test";
import assert from "node:assert/strict";
import { compatibleRelease, releaseSchema } from "../../src/lib/app-release";

test("public release metadata is bounded and contains no authority or resident fields", () => {
  const valid = {
    version: "a".repeat(64),
    storageVersion: 1,
    operationVersion: 1,
  };
  assert.deepEqual(releaseSchema.parse(valid), valid);
  for (const value of [
    { ...valid, version: "" },
    { ...valid, version: "a".repeat(65) },
    { ...valid, token: "not-allowed" },
    { ...valid, households: [] },
    { ...valid, storageVersion: 0 },
  ])
    assert.equal(releaseSchema.safeParse(value).success, false);
});
test("reload support fails closed for unknown storage or operation versions", () => {
  assert.equal(
    compatibleRelease({
      version: "a".repeat(64),
      storageVersion: 1,
      operationVersion: 1,
    }),
    true,
  );
  assert.equal(
    compatibleRelease({
      version: "a".repeat(64),
      storageVersion: 2,
      operationVersion: 1,
    }),
    false,
  );
  assert.equal(
    compatibleRelease({
      version: "a".repeat(64),
      storageVersion: 1,
      operationVersion: 2,
    }),
    false,
  );
});
