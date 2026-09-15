import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  operatorConnection,
  readOperatorPassword,
} from "../../src/server/operator-connection";

const template =
  "postgresql://postgres.synthetic:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres";
const project = "https://synthetic.supabase.co";
const ca = "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----";

test("operator password is encoded intact and certificate verification remains required", () => {
  const password = " synthetic:@/#?%$'\\password ";
  const options = operatorConnection(template, project, password, ca);
  assert.equal(
    decodeURIComponent(new URL(options.connectionString!).password),
    password,
  );
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca });
});

test("operator connection rejects wrong project, host, port, insecure settings and invalid secrets", () => {
  for (const url of [
    template.replace("postgres.synthetic", "postgres.other"),
    template.replace("pooler.supabase.com", "attacker.test"),
    template.replace(":5432", ":6543"),
    template + "?sslmode=disable",
    template.replace("[YOUR-PASSWORD]", "already-a-secret"),
  ])
    assert.throws(() => operatorConnection(url, project, "synthetic", ca));
  for (const password of ["", "x\ny", "x\0y", "x".repeat(4097)])
    assert.throws(() => operatorConnection(template, project, password, ca));
  assert.throws(() => operatorConnection(template, project, "synthetic", ""));
});

test("operator stdin is bounded and preserves whitespace and multibyte passwords", async () => {
  const input = Buffer.from(" synthetic-é ");
  assert.equal(
    await readOperatorPassword(
      Readable.from([input.subarray(0, 12), input.subarray(12)]),
    ),
    input.toString(),
  );
  await assert.rejects(
    () => readOperatorPassword(Readable.from([Buffer.alloc(4097)])),
    /Invalid operator input/,
  );
});
