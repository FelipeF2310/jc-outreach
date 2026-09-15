import { z } from "zod";

export const outcomes = {
  resident: "Spoke with resident",
  other: "Spoke with someone else",
  no_answer: "No answer",
  inaccessible: "Inaccessible",
  declined: "Declined conversation",
} as const;
export const programNames = {
  freeze: "Senior Freeze",
  stay: "Stay NJ",
  anchor: "ANCHOR",
} as const;
export const correctionNames = {
  rents: "Says they rent",
  moved: "Person moved",
  deceased: "Person reported deceased",
  address: "Wrong address",
} as const;
export const accessReasons = {
  locked: "Locked lobby / entrance",
  security: "Doorman or security denied access",
  entrance: "Unable to locate entrance",
  other: "Other",
} as const;
const uuid = z.uuid();
const timestamp = z.iso.datetime();
const result = z.enum([
  "resident",
  "other",
  "no_answer",
  "inaccessible",
  "declined",
]);
const program = z.enum(["freeze", "stay", "anchor"]);
const base = {
  id: uuid,
  assignmentId: uuid,
  createdAt: timestamp,
  schemaVersion: z.literal(1),
};
const help = z
  .strictObject({
    id: uuid,
    personId: uuid.nullable(),
    phone: z.string().trim().max(32),
    consent: z.boolean(),
    arrangement: z.enum(["return", "referral", "unspecified"]),
  })
  .refine((h) => !h.phone || h.consent, {
    message:
      "Remove the phone number or record permission for application-help contact.",
  });
const correction = z
  .strictObject({
    id: uuid,
    kind: z.enum(["rents", "moved", "deceased", "address"]),
    personId: uuid.nullable(),
  })
  .refine(
    (c) => !["moved", "deceased"].includes(c.kind) || c.personId !== null,
    { message: "Select the person this report concerns." },
  );
export const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...base,
    kind: z.literal("visit"),
    visitId: uuid,
    householdId: uuid,
    result,
    programs: z.array(program).max(3),
    help: help.nullable(),
    corrections: z.array(correction).max(8),
    doNotContact: z.boolean(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("revision"),
    visitId: uuid,
    householdId: uuid,
    originalOperationId: uuid,
    previousOperationId: uuid,
    result,
  }),
  z.strictObject({
    ...base,
    kind: z.literal("building"),
    buildingId: uuid,
    reason: z.enum(["locked", "security", "entrance", "other"]),
  }),
]);
export type Operation = z.infer<typeof operationSchema>;
export type VisitOperation = Extract<Operation, { kind: "visit" }>;
export type Outcome = keyof typeof outcomes;
export type ProgramId = keyof typeof programNames;
export type Person = { id: string; firstName: string; lastName: string };
export type Household = {
  id: string;
  buildingId: string;
  address: string;
  unit: string;
  suppressed: boolean;
  people: Person[];
};
export type Assignment = {
  id: string;
  campaignId: string;
  name: string;
  eventName: string;
  eventEndsAt: string;
  deletionAt: string;
  synthetic: true;
  households: Household[];
  supersededHouseholdIds?: string[];
  programs: {
    id: ProgramId;
    name: string;
    summary: string;
    source: string;
    url: string;
    reviewedAt: string | null;
  }[];
};
export type Receipt = { operationId: string; receivedAt: string };
export class DomainError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
