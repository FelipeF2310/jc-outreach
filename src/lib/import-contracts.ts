/** Canonical source schema; the discarded rationale column also accepts "Rationale". */
export const sourceHeaders = [
  "VANID",
  "Last Name",
  "First Name",
  "Age",
  "Residence Address",
  "Zip",
  "Ward",
  "Block",
  "Lot",
  "Qual",
  "Property Location",
  "Unit (verified)",
  "Owner of Record",
  "Matched Owner Name",
  "Tier",
  "Tier Label",
  "Match Rationale",
  "Persons in Household",
  "Household Key",
  "Other Parcels Matched",
  "Score",
] as const;
export const persistedHeaders = [
  "VANID",
  "First Name",
  "Last Name",
  "Residence Address",
  "Zip",
  "Ward",
  "Block",
  "Lot",
  "Qual",
  "Property Location",
  "Unit (verified)",
  "Tier",
  "Household Key",
] as const;
export type ImportRow = Record<(typeof persistedHeaders)[number], string>;
export type ImportIssue = {
  code: string;
  message: string;
  records: number[];
  count: number;
};
export type ImportCounts = {
  people: number;
  households: number;
  buildings: number;
};
export type ImportPreview = {
  valid: boolean;
  counts: ImportCounts | null;
  issues: ImportIssue[];
  digest: string | null;
  households: {
    key: string;
    address: string;
    unit: string;
    people: { firstName: string; lastName: string }[];
  }[];
};
export type ImportReceipt = {
  importId: string;
  campaignId: string;
  counts: ImportCounts;
  finalizedAt: string;
};
