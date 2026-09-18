import { z } from "zod";

export const correctionStatus = z.enum(["Open", "Reviewed"]);
export const correctionUpdate = z.strictObject({
  action: z.literal("update"),
  id: z.uuid(),
  campaignId: z.uuid(),
  reportId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  status: z.enum(["Open", "Reviewed"]),
});
export const correctionAdminRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), campaignId: z.uuid() }),
  correctionUpdate,
]);
export type CorrectionUpdate = z.infer<typeof correctionUpdate>;
export const correctionQueue = z.object({
  campaignId: z.uuid(),
  ready: z.boolean(),
  reports: z.array(
    z.object({
      id: z.uuid(),
      visitId: z.uuid(),
      assignmentName: z.string(),
      address: z.string(),
      unit: z.string(),
      person: z.string().nullable(),
      kind: z.enum(["rents", "moved", "deceased", "address"]),
      suppressed: z.boolean(),
      status: correctionStatus,
      version: z.number().int().nonnegative(),
      receivedAt: z.string(),
      updatedAt: z.string().nullable(),
    }),
  ),
});
export type CorrectionQueue = z.infer<typeof correctionQueue>;
export const correctionReceipt = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  reportId: z.uuid(),
  status: correctionStatus,
  version: z.number().int().positive(),
});
