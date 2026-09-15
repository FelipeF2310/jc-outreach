import { test } from "node:test";
import assert from "node:assert/strict";
import { safeConnectionFailure } from "../../src/server/owner-preflight";

test("owner diagnostics expose only fixed categories, never raw error fields", () => {
  const secret = "SYNTHETIC_PRIVATE_ERROR_CONTENT";
  for (const code of [
    "28P01",
    "42501",
    "ENOTFOUND",
    "ECONNRESET",
    "SELF_SIGNED_CERT_IN_CHAIN",
    secret,
    "__proto__",
    "toString",
  ]) {
    const output = safeConnectionFailure({
      code,
      message: secret,
      detail: secret,
      stack: secret,
      connectionString: secret,
    });
    assert.equal(typeof output, "string");
    assert.ok(!output.includes(secret));
  }
  assert.equal(safeConnectionFailure({ code: "42501" }), "permission_denied");
  assert.equal(
    safeConnectionFailure(
      new Error(`password authentication failed for ${secret}`),
    ),
    "password_rejected",
  );
  assert.equal(
    safeConnectionFailure(new Error(`Connection terminated ${secret}`)),
    "connection_terminated",
  );
  for (const input of [undefined, null, secret, {}, new Error(secret)])
    assert.equal(safeConnectionFailure(input), "unclassified_failure");
});
