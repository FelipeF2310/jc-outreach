import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import {
  operatorConnection,
  readOperatorPassword,
} from "../../src/server/operator-connection";

const writer = fileURLToPath(
  new URL("../../scripts/lib/operator-password.sh", import.meta.url),
);
const template =
  "postgresql://postgres.synthetic:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres";
const ca = "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----";

test("operator shell handoff preserves password bytes without an added newline", async () => {
  for (const password of [
    "synthetic-only-password",
    " synthetic-é:@/#?%$'\\password ",
    "-n-not-a-printf-option",
  ]) {
    // This is the actual sourced writer used by the private launcher. Only
    // synthetic stdin is supplied; no environment file or database is opened.
    const bytes = execFileSync(
      "/bin/sh",
      [
        "-c",
        '. "$1"; IFS= read -r jco_test_password; jco_write_operator_password "$jco_test_password"',
        "operator-handoff-test",
        writer,
      ],
      { input: `${password}\n` },
    );
    const received = await readOperatorPassword(Readable.from([bytes]));
    assert.equal(received, password);
    const options = operatorConnection(
      template,
      "https://synthetic.supabase.co",
      received,
      ca,
    );
    assert.equal(
      decodeURIComponent(new URL(options.connectionString!).password),
      password,
    );
    assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca });
  }
});

test("operator password writer without an argument fails without printing input", () => {
  assert.throws(
    () =>
      execFileSync(
        "/bin/sh",
        [
          "-c",
          '. "$1"; jco_write_operator_password',
          "operator-handoff-test",
          writer,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      ),
    (error: unknown) =>
      error instanceof Error &&
      "status" in error &&
      error.status === 2 &&
      "stdout" in error &&
      Buffer.isBuffer(error.stdout) &&
      error.stdout.length === 0,
  );
});
