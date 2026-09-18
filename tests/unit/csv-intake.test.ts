import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CSV_BODY_BYTES,
  CSV_PREVIEW_HOUSEHOLD_BYTES,
  readCsvBody,
  importCsvBytes,
} from "../../src/server/csv-intake";
import { DomainError } from "../../src/lib/contracts";
import { rehearsalCsv } from "../../src/lib/synthetic-csv";
import { validateImport } from "../../src/server/import-validation";
import type { Database } from "../../src/server/db-contract";
import fixture from "../fixtures/outreach.json";
import { sourceHeaders } from "../../src/lib/import-contracts";

const status = (value: number) => (error: unknown) =>
  error instanceof DomainError && error.status === value;
const bytes = rehearsalCsv("valid-couple-and-buildings");
const request = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://fixture.invalid", {
    method: "POST",
    body,
    headers: { "content-type": "text/csv; charset=utf-8", ...headers },
    duplex: "half",
  } as RequestInit);

test("CSV transport accepts exact UTF-8 bytes without JSON or filename fields", async () => {
  assert.deepEqual(await readCsvBody(request(bytes)), Buffer.from(bytes));
  const full = new Uint8Array(CSV_BODY_BYTES).fill(65);
  assert.equal((await readCsvBody(request(full))).length, CSV_BODY_BYTES);
});

test("CSV transport bounds actual streamed bytes, sanitizes failures and ignores no size overflow", async () => {
  await assert.rejects(readCsvBody(request(null)), status(400));
  await assert.rejects(
    readCsvBody(request(bytes, { "content-type": "application/json" })),
    status(415),
  );
  await assert.rejects(
    readCsvBody(request(bytes, { "content-encoding": "gzip" })),
    status(415),
  );
  await assert.rejects(
    readCsvBody(
      request(bytes, { "content-length": String(CSV_BODY_BYTES + 1) }),
    ),
    status(413),
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(CSV_BODY_BYTES));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
      throw Error("SYNTHETIC_PRIVATE_FILENAME");
    },
  });
  await assert.rejects(
    readCsvBody(request(stream, { "content-length": "1" })),
    status(413),
  );
  assert.equal(cancelled, true);
  const broken = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(Error("SYNTHETIC_PRIVATE_SOURCE"));
    },
  });
  await assert.rejects(
    readCsvBody(request(broken)),
    (error) =>
      status(400)(error) && !String(error).includes("SYNTHETIC_PRIVATE_SOURCE"),
  );
});

test("general CSV service validates exact bytes, confirmation, actor, minimization and sanitized errors", async () => {
  const campaignId = randomUUID(),
    actor = randomUUID();
  let calls = 0,
    writes = 0,
    authorized = true,
    fail = false;
  const db: Database = {
    async transaction(work) {
      return work(db);
    },
    async exec() {
      throw Error("Unexpected raw statement");
    },
    async query<T>(sql: string, parameters?: unknown[]) {
      calls++;
      if (sql.includes("AS allowed"))
        return { rows: [{ allowed: authorized }] as T[] };
      assert.ok(sql.startsWith("SELECT outreach.finalize_csv_import("));
      writes++;
      const rows = JSON.parse(parameters![2] as string);
      assert.ok(
        rows.every(
          (row: object) =>
            !Object.hasOwn(row, "Age") &&
            !Object.hasOwn(row, "Match Rationale") &&
            !Object.hasOwn(row, "Score"),
        ),
      );
      if (fail)
        throw Object.assign(Error("SYNTHETIC_PRIVATE_DATABASE_DETAIL"), {
          code: "23505",
        });
      return {
        rows: [
          {
            receipt: {
              campaignId,
              importId: randomUUID(),
              counts: { people: 4, households: 3, buildings: 2 },
              finalizedAt: new Date().toISOString(),
            },
          },
        ] as T[],
      };
    },
  };
  const preview = { action: "preview", campaignId };
  for (const input of [
    { ...preview, actor },
    { ...preview, action: "finalize", digest: "a".repeat(64) },
    { ...preview, campaignId: "invalid" },
  ])
    await assert.rejects(importCsvBytes(db, input, bytes, actor), status(400));
  assert.equal(calls, 0);
  authorized = false;
  await assert.rejects(importCsvBytes(db, preview, bytes, actor), status(404));
  authorized = true;
  const result = await importCsvBytes(db, preview, bytes, actor);
  assert.ok("preview" in result && result.preview.valid);
  const invalid = await importCsvBytes(
    db,
    preview,
    rehearsalCsv("tier-three"),
    actor,
  );
  assert.ok(
    "preview" in invalid &&
      !invalid.preview.valid &&
      invalid.preview.households.length === 0,
  );
  const finalize = {
    ...preview,
    action: "finalize",
    confirmed: true,
    digest: validateImport(bytes).preview.digest,
  };
  await assert.rejects(
    importCsvBytes(db, { ...finalize, digest: "0".repeat(64) }, bytes, actor),
    status(409),
  );
  await assert.rejects(
    importCsvBytes(db, finalize, rehearsalCsv("tier-three"), actor),
    status(422),
  );
  assert.equal(writes, 0);
  assert.ok("receipt" in (await importCsvBytes(db, finalize, bytes, actor)));
  fail = true;
  await assert.rejects(
    importCsvBytes(db, finalize, bytes, actor),
    (error) =>
      status(503)(error) &&
      !String(error).includes("SYNTHETIC_PRIVATE_DATABASE_DETAIL"),
  );
});

test("preview response is byte-bounded even with oversized household groups and JSON escaping", async () => {
  const rows: Record<string, string>[] = Array.from(
    { length: 300 },
    (_, i) => ({
      ...fixture.records[0],
      VANID: String(i).padStart(8, "0"),
      "First Name": "\\".repeat(700),
      "Last Name": "Fixture".repeat(100),
      "Persons in Household": "300",
    }),
  );
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = new TextEncoder().encode(
    [
      sourceHeaders.map(quote).join(","),
      ...rows.map((row) =>
        sourceHeaders.map((key) => quote(row[key])).join(","),
      ),
    ].join("\r\n"),
  );
  assert.ok(csv.length < CSV_BODY_BYTES);
  const db: Database = {
    async transaction(work) {
      return work(db);
    },
    async exec() {
      throw Error("Unexpected write");
    },
    async query<T>(sql: string) {
      assert.ok(sql.includes("AS allowed"));
      return { rows: [{ allowed: true }] as T[] };
    },
  };
  const result = await importCsvBytes(
    db,
    { action: "preview", campaignId: randomUUID() },
    csv,
    randomUUID(),
  );
  assert.ok("preview" in result && result.preview.valid);
  assert.equal(result.preview.counts?.people, 300);
  assert.equal(result.preview.previewTruncated, true);
  assert.equal(
    result.preview.households.length,
    0,
    "an oversized group is not partially misrepresented",
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(result)) < CSV_PREVIEW_HOUSEHOLD_BYTES,
  );
});
