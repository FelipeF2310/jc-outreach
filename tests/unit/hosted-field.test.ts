import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fieldEndpoint } from "../../src/server/field-http";
import {
  hostedFieldAdmin,
  downloadHostedAssignment,
  submitHostedOperation,
} from "../../src/server/hosted-field";
import type { Database } from "../../src/server/db-contract";
import { DomainError } from "../../src/lib/contracts";
test("field transport requires explicit hosting, same origin and a bearer link; administrator headers grant no volunteer access", async () => {
  const settings = {
    JCO_SYNTHETIC_ONLY: "",
    JCO_HOSTED_STAGE: "synthetic-preview",
    JCO_APP_ORIGIN: "https://outreach.example.test",
    JCO_SUPABASE_URL: "https://synthetic.supabase.co",
    JCO_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
    JCO_ADMIN_EMAILS: "organizer@example.test",
    DATABASE_URL: "",
  };
  const previous = { ...process.env };
  Object.assign(process.env, settings);
  try {
    for (const [method, headers, status] of [
      ["GET", {}, 401],
      ["GET", { "X-JCO-Admin": "1", "X-JCO-Demo": "1" }, 401],
      [
        "POST",
        {
          Origin: "https://untrusted.example.test",
          Authorization: "Bearer " + "a".repeat(43),
        },
        403,
      ],
      ["POST", { Authorization: "Bearer " + "a".repeat(43) }, 403],
    ] as const) {
      const response = await fieldEndpoint(
        new Request("https://outreach.example.test/api/assignment", {
          method,
          headers,
        }),
        method === "GET" ? "download" : "submit",
      );
      assert.equal(response.status, status);
      assert.match(response.headers.get("cache-control")!, /no-store/);
    }
    process.env.JCO_HOSTED_STAGE = "";
    assert.equal(
      (
        await fieldEndpoint(
          new Request("https://outreach.example.test/api/assignment"),
          "download",
        )
      ).status,
      503,
    );
  } finally {
    for (const key of Object.keys(settings)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
test("hosted field service rejects raw credentials, forged authority, malformed operations and unconfirmed revocation", async () => {
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
  for (const input of [
    { action: "issue", id, assignmentId: id, token: "x" },
    { action: "issue", id, assignmentId: id, actor: id },
    { action: "revoke", id, assignmentId: id },
    { action: "status", assignmentId: id, rows: [] },
  ])
    await assert.rejects(
      () => hostedFieldAdmin(db, input, id),
      (e) => e instanceof DomainError && e.status === 400,
    );
  await assert.rejects(() => downloadHostedAssignment(db, "invalid"));
  await assert.rejects(() =>
    submitHostedOperation(db, "x".repeat(43), { rows: [] }),
  );
  assert.equal(calls, 0);
});
