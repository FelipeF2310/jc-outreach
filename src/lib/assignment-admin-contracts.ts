import { z } from "zod";

const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const assignmentAdminRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("workspace"), campaignId: z.uuid() }),
  z.strictObject({
    action: z.literal("event"),
    campaignId: z.uuid(),
    id: z.uuid(),
    name: label,
    endDate: z.iso
      .date()
      .refine((value) => value >= "2000-01-01" && value <= "9998-12-31"),
  }),
  z.strictObject({
    action: z.literal("assignment"),
    campaignId: z.uuid(),
    eventId: z.uuid(),
    id: z.uuid(),
    name: label,
    kind: z.enum(["building", "scattered"]),
    householdIds: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
]);
export type AssignmentAdminRequest = z.infer<typeof assignmentAdminRequest>;
export type AssignmentSave = Exclude<
  AssignmentAdminRequest,
  { action: "workspace" }
>;
export type AssignmentWorkspace = {
  campaignId: string;
  endAt: string;
  deletionAt: string;
  households: {
    id: string;
    buildingId: string;
    address: string;
    unit: string;
    ward: string;
    peopleCount: number;
    suppressed: boolean;
  }[];
  events: { id: string; name: string; endsAt: string }[];
  assignments: {
    id: string;
    eventId: string;
    name: string;
    kind: "building" | "scattered";
    householdIds: string[];
  }[];
};
