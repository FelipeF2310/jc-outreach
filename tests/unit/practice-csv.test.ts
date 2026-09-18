import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  identifyPracticeCsv,
  practiceCsvExamples,
  PRACTICE_CSV_MAX_BYTES,
  readPracticeCsv,
  rehearsalCsv,
} from "../../src/lib/synthetic-csv";
import { validateImport } from "../../src/server/import-validation";

test("shared fixture bytes retain the immutable hosted finalizer digest", () => {
  assert.equal(
    createHash("sha256")
      .update(rehearsalCsv("valid-couple-and-buildings"))
      .digest("hex"),
    "8ac68dd351b7737b3d341480a6e927eada801ee8324b01d614e4bb4f53e3b707",
  );
});

test("practice file recognition is exact and does not imply valid population/grouping", () => {
  for (const example of practiceCsvExamples) {
    const bytes = rehearsalCsv(example.id);
    assert.equal(identifyPracticeCsv(bytes), example.id);
    assert.equal(
      validateImport(bytes).preview.valid,
      example.id === "valid-couple-and-buildings",
    );
    const changed = bytes.slice();
    changed[changed.length - 1] ^= 1;
    assert.equal(identifyPracticeCsv(changed), undefined);
    assert.equal(
      identifyPracticeCsv(new Uint8Array([...bytes, 10])),
      undefined,
    );
  }
  assert.equal(identifyPracticeCsv(new Uint8Array()), undefined);
  assert.equal(
    identifyPracticeCsv(new Uint8Array(PRACTICE_CSV_MAX_BYTES + 1)),
    undefined,
  );
  // Even a structurally valid variation is not an approved practice artifact.
  const variation = new TextEncoder().encode(
    new TextDecoder()
      .decode(rehearsalCsv(practiceCsvExamples[0].id))
      .replace("Match Rationale", "Rationale"),
  );
  assert.equal(validateImport(variation).preview.valid, true);
  assert.equal(identifyPracticeCsv(variation), undefined);
});

test("practice selection reads only bounded CSVs and never trusts filenames", async () => {
  let reads = 0;
  const file = {
    name: "synthetic-marker.csv",
    size: 1,
    async arrayBuffer() {
      reads++;
      return rehearsalCsv(practiceCsvExamples[0].id).buffer;
    },
  };
  for (const invalid of [
    { ...file, size: 0 },
    { ...file, size: PRACTICE_CSV_MAX_BYTES + 1 },
    { ...file, name: "synthetic-marker.xlsx" },
  ])
    await assert.rejects(readPracticeCsv(invalid), /nonempty practice \.csv/);
  assert.equal(reads, 0);
  assert.equal(
    await readPracticeCsv({ ...file, name: "renamed.CSV" }),
    practiceCsvExamples[0].id,
  );
  assert.equal(reads, 1);
  await assert.rejects(
    readPracticeCsv({
      ...file,
      name: "jco-practice-valid-couple-and-buildings.csv",
      arrayBuffer: async () =>
        new TextEncoder().encode("SYNTHETIC_UNAPPROVED_CONTENT").buffer,
    }),
    /File not recognized/,
  );
});

test("practice file read failures never expose file details or raw exception messages", async () => {
  await assert.rejects(
    readPracticeCsv({
      name: "SYNTHETIC_PRIVATE_FILENAME.csv",
      size: 10,
      arrayBuffer: async () => {
        throw new Error("SYNTHETIC_PRIVATE_CONTENT");
      },
    }),
    (error: Error) => {
      assert.equal(
        error.message,
        "The practice file could not be read. Select it again.",
      );
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});
