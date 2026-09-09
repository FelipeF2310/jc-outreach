import { parse } from "csv-parse/sync";
import { createHash } from "node:crypto";
import {
  persistedHeaders,
  sourceHeaders,
  type ImportIssue,
  type ImportPreview,
  type ImportRow,
} from "../lib/import-contracts";

export const IMPORT_LIMITS = {
  bytes: 5 * 1024 * 1024,
  rows: 10000,
  recordCharacters: 65536,
  fieldCharacters: 1000,
};
export const normalizeGrouping = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();
export const buildingKey = (row: ImportRow) =>
  JSON.stringify([normalizeGrouping(row["Property Location"]), row.Zip]);
export type ValidatedImport = { preview: ImportPreview; rows: ImportRow[] };

/** No logging, disk writes, database access, inferred eligibility or source enrichment. */
export function validateImport(bytes: Uint8Array): ValidatedImport {
  const issues = new Map<string, ImportIssue>();
  function issue(code: string, message: string, record?: number) {
    const existing = issues.get(code) ?? {
      code,
      message,
      records: [],
      count: 0,
    };
    existing.count++;
    if (
      record !== undefined &&
      existing.records.length < 20 &&
      !existing.records.includes(record)
    )
      existing.records.push(record);
    issues.set(code, existing);
  }
  const rejected = (): ValidatedImport => ({
    rows: [],
    preview: {
      valid: false,
      counts: null,
      digest: null,
      households: [],
      issues: [...issues.values()],
    },
  });
  if (!bytes.length || bytes.length > IMPORT_LIMITS.bytes) {
    issue("file_size", "Use a nonempty UTF-8 CSV no larger than 5 MiB.");
    return rejected();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    issue(
      "encoding",
      "The file is not valid UTF-8. Export it as UTF-8 CSV and retry.",
    );
    return rejected();
  }
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      columns: false,
      cast: false,
      skip_empty_lines: true,
      max_record_size: IMPORT_LIMITS.recordCharacters,
    });
  } catch {
    // Parser exceptions can include raw values. Never propagate them or their causes.
    issue(
      "csv_syntax",
      "The CSV has malformed quoting, inconsistent columns, or an oversized record.",
    );
    return rejected();
  }
  const headers = records.shift() ?? [];
  if (
    headers.length !== sourceHeaders.length ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (h) => !sourceHeaders.includes(h as (typeof sourceHeaders)[number]),
    )
  ) {
    issue(
      "headers",
      "Headers must match the approved 21-column schema, with no missing, repeated, or unknown columns.",
    );
    return rejected();
  }
  if (!records.length || records.length > IMPORT_LIMITS.rows) {
    issue(
      "row_count",
      "The CSV must contain between 1 and 10,000 resident records.",
    );
    return rejected();
  }
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  // Complete population check BEFORE returning names or constructing any preview.
  records.forEach((record, offset) => {
    if (!["1", "2"].includes(record[index.Tier].trim()))
      issue(
        "tier",
        "Only Tier 1 and Tier 2 are permitted. No records will be imported.",
        offset + 2,
      );
  });
  if (issues.size) return rejected();
  const rows: ImportRow[] = [];
  const groups = new Map<string, { row: ImportRow; indices: number[] }>();
  const buildings = new Map<
    string,
    { ward: string; keys: Set<string>; emptyUnit: boolean }
  >();
  const people = new Set<string>(),
    doors = new Map<string, string>();
  records.forEach((values, offset) => {
    const number = offset + 2;
    const row = Object.fromEntries(
      persistedHeaders.map((header) => [header, values[index[header]].trim()]),
    ) as ImportRow;
    if (
      persistedHeaders.some(
        (h) => h !== "Qual" && h !== "Unit (verified)" && !row[h],
      )
    )
      issue(
        "required",
        "A required resident, address, identifier, or household field is missing.",
        number,
      );
    if (
      Object.values(row).some(
        (value) =>
          value.length > IMPORT_LIMITS.fieldCharacters ||
          /[\u0000-\u001f\u007f]/.test(value),
      )
    )
      issue(
        "field_format",
        "A retained field is oversized or contains unsupported control characters.",
        number,
      );
    if (!/^\d{5}$/.test(row.Zip) || !/^[A-F]$/.test(row.Ward))
      issue(
        "location",
        "ZIP must contain five digits and Ward must be A through F.",
        number,
      );
    if (row["Household Key"] !== [row.Block, row.Lot, row.Qual].join("-"))
      issue(
        "household_key",
        "Household Key does not match the text Block-Lot-Qual identifiers.",
        number,
      );
    if (people.has(row.VANID))
      issue(
        "duplicate_person",
        "A source person identifier appears more than once. Correct the source file.",
        number,
      );
    people.add(row.VANID);
    const key = row["Household Key"],
      building = buildingKey(row),
      unit = normalizeGrouping(row["Unit (verified)"]);
    const group = groups.get(key);
    if (group) {
      if (
        normalizeGrouping(group.row["Residence Address"]) !==
          normalizeGrouping(row["Residence Address"]) ||
        normalizeGrouping(group.row["Unit (verified)"]) !== unit ||
        buildingKey(group.row) !== building
      )
        issue(
          "group_conflict",
          "One Household Key contains conflicting addresses or units. Correct the source file.",
          number,
        );
      group.indices.push(offset);
    } else groups.set(key, { row, indices: [offset] });
    const door = JSON.stringify([building, unit]);
    if (doors.has(door) && doors.get(door) !== key)
      issue(
        "duplicate_door",
        "Different Household Keys describe the same building and unit. Review the source grouping.",
        number,
      );
    doors.set(door, key);
    const buildingInfo = buildings.get(building) ?? {
      ward: row.Ward,
      keys: new Set<string>(),
      emptyUnit: false,
    };
    if (buildingInfo.ward !== row.Ward)
      issue("building_ward", "A building has conflicting Ward values.", number);
    buildingInfo.keys.add(key);
    buildingInfo.emptyUnit ||= !unit;
    buildings.set(building, buildingInfo);
    if (
      !unit &&
      /(?:\b(?:APT|APARTMENT|UNIT|SUITE|STE)\s+\S|#\s*\S)/i.test(
        row["Residence Address"],
      )
    )
      issue(
        "missing_unit",
        "The residence address indicates a unit but the verified unit is missing.",
        number,
      );
    rows.push(row);
  });
  for (const building of buildings.values())
    if (building.keys.size > 1 && building.emptyUnit)
      issue(
        "missing_unit",
        "A multi-household building includes a household without a verified unit.",
      );
  for (const group of groups.values())
    for (const offset of group.indices) {
      const declared = records[offset][index["Persons in Household"]].trim();
      if (
        declared &&
        (!/^\d+$/.test(declared) || Number(declared) !== group.indices.length)
      )
        issue(
          "household_count",
          "The declared household person count differs from the grouped source records. Correct the source file.",
          offset + 2,
        );
    }
  if (issues.size) return rejected();
  const households = [...groups.values()].map((group) => ({
    key: group.row["Household Key"],
    address: group.row["Property Location"],
    unit: group.row["Unit (verified)"],
    people: group.indices.map((i) => ({
      firstName: rows[i]["First Name"],
      lastName: rows[i]["Last Name"],
    })),
  }));
  return {
    rows,
    preview: {
      valid: true,
      issues: [],
      digest: createHash("sha256").update(bytes).digest("hex"),
      counts: {
        people: rows.length,
        households: groups.size,
        buildings: buildings.size,
      },
      households,
    },
  };
}
