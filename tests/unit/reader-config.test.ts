import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  chmod,
  stat,
  symlink,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import {
  readerConfiguration,
  readPrivateConfiguration,
  savePrivateConfiguration,
} from "../../src/server/reader-config";

const template =
  "postgresql://postgres.synthetic:[YOUR-PASSWORD]@aws-0-us-east-2.pooler.supabase.com:5432/postgres";
const ca =
  "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----\n";
const source =
  "# Keep unrelated settings\nJCO_HOSTED_STAGE=synthetic-preview\nJCO_SUPABASE_URL=https://synthetic.supabase.co\nOTHER=unchanged\nDATABASE_URL=\nJCO_DATABASE_CA=\n";

test("reader configuration preserves settings and safely encodes special password characters", () => {
  const password = " synthetic:@/#?%$'\\secret ";
  const result = readerConfiguration(source, template, password, ca);
  const env = parseEnv(result.source);
  assert.ok(env.DATABASE_URL);
  assert.equal(env.OTHER, "unchanged");
  assert.ok(result.source.startsWith("# Keep unrelated settings\n"));
  assert.equal(
    new URL(env.DATABASE_URL).username,
    "jco_admin_reader.synthetic",
  );
  assert.equal(
    decodeURIComponent(new URL(env.DATABASE_URL).password),
    password,
  );
  assert.equal(env.JCO_DATABASE_CA, ca.trim());
  assert.equal(env.DATABASE_URL, result.connectionString);
});

test("reader configuration refuses replacement, ambiguous keys and other project modes", () => {
  for (const invalid of [
    source.replace("DATABASE_URL=", "DATABASE_URL=already-configured"),
    source.replace("JCO_DATABASE_CA=", "JCO_DATABASE_CA=already-configured"),
    source + "DATABASE_URL=\n",
    source.replace("DATABASE_URL=", "export DATABASE_URL="),
    source.replace("DATABASE_URL=\n", ""),
    source.replace("synthetic-preview", "production"),
    source + "JCO_SYNTHETIC_ONLY=1\n",
  ])
    assert.throws(() =>
      readerConfiguration(invalid, template, "synthetic", ca),
    );
  assert.throws(() =>
    readerConfiguration(
      source,
      template.replace("postgres.synthetic", "postgres.other"),
      "synthetic",
      ca,
    ),
  );
});

test("private configuration is replaced atomically at mode 0600 and concurrent edits survive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jco-reader-config-"));
  const path = join(dir, ".env.local");
  try {
    await writeFile(path, source, { mode: 0o600 });
    assert.equal(await readPrivateConfiguration(path), source);
    const next = readerConfiguration(
      source,
      template,
      "synthetic-secret",
      ca,
    ).source;
    await savePrivateConfiguration(path, source, next);
    assert.equal(await readFile(path, "utf8"), next);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(() =>
      savePrivateConfiguration(path, source, "must not replace"),
    );
    assert.equal(await readFile(path, "utf8"), next);
    assert.deepEqual(await readdir(dir), [".env.local"]);
    await chmod(path, 0o644);
    await assert.rejects(() => readPrivateConfiguration(path));
    await chmod(path, 0o600);
    const link = join(dir, "link");
    await symlink(path, link);
    await assert.rejects(() => readPrivateConfiguration(link));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
