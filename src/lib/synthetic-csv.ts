import fixture from "../../tests/fixtures/outreach.json";
import cases from "../../tests/fixtures/import-cases.json";
import { DomainError } from "./contracts";

/** Known, explicitly synthetic bytes only. No user-supplied rows are accepted. */
export function rehearsalCsv(caseId: string) {
  const example = cases.cases.find((c) => c.id === caseId);
  if (!example) throw new DomainError(400, "Unknown synthetic example.");
  const rows: Record<string, string>[] = structuredClone(fixture.records);
  for (const change of example.changes) {
    if ("sourceRow" in change)
      Object.assign(rows[change.sourceRow], change.set);
    if ("appendCopyOf" in change) rows.push({ ...rows[change.appendCopyOf] });
    if ("deleteFieldFromAll" in change)
      for (const row of rows) delete row[change.deleteFieldFromAll];
    if ("setFieldOnAll" in change)
      for (const row of rows)
        row[change.setFieldOnAll.key] = change.setFieldOnAll.value;
  }
  const headers = Object.keys(rows[0]);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return new TextEncoder().encode(
    [
      headers.map(quote).join(","),
      ...rows.map((row) => headers.map((h) => quote(row[h])).join(",")),
    ].join("\r\n"),
  );
}

export const practiceCsvExamples = [
  {
    id: "valid-couple-and-buildings",
    label: "Valid example — 4 people, 3 doors",
  },
  { id: "tier-three", label: "Error example — disallowed Tier 3" },
  { id: "conflicting-unit", label: "Error example — conflicting units" },
] as const;

// This small bound is for fixed practice files, not the future real CSV limit.
export const PRACTICE_CSV_MAX_BYTES = 64 * 1024;

/** Exact recognition, not validation/provenance of an arbitrary source file.
 * The browser sends only the matched case ID; the server regenerates its own
 * bytes, validates them and retains its existing fixed-fixture finalizer.
 */
export function identifyPracticeCsv(bytes: Uint8Array): string | undefined {
  if (!bytes.length || bytes.length > PRACTICE_CSV_MAX_BYTES) return;
  return practiceCsvExamples.find(({ id }) => {
    const known = rehearsalCsv(id);
    return (
      known.length === bytes.length &&
      known.every((value, index) => value === bytes[index])
    );
  })?.id;
}

/** Reject size/type before reading; never return a filename, raw bytes or errors. */
export async function readPracticeCsv(file: {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<string> {
  if (
    !/\.csv$/i.test(file.name) ||
    !file.size ||
    file.size > PRACTICE_CSV_MAX_BYTES
  )
    throw new Error(
      "Choose a nonempty practice .csv file no larger than 64 KiB.",
    );
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error("The practice file could not be read. Select it again.");
  }
  const caseId = identifyPracticeCsv(bytes);
  if (!caseId)
    throw new Error(
      "File not recognized. Choose an unchanged practice CSV downloaded here. Real resident files are not accepted or uploaded.",
    );
  return caseId;
}
