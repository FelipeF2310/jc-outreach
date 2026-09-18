import { z } from "zod";

export const helpStatus = z.enum(["New", "In progress", "Resolved"]);
export const helpUpdate = z.strictObject({
  action: z.literal("update"),
  id: z.uuid(),
  campaignId: z.uuid(),
  requestId: z.uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
  status: z.enum(["In progress", "Resolved"]),
});
export const helpAdminRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("list"), campaignId: z.uuid() }),
  helpUpdate,
]);
export type HelpUpdate = z.infer<typeof helpUpdate>;
export const helpQueue = z.object({
  campaignId: z.uuid(),
  ready: z.boolean(),
  requests: z.array(
    z.object({
      id: z.uuid(),
      visitId: z.uuid(),
      assignmentName: z.string(),
      address: z.string(),
      unit: z.string(),
      requester: z.string().nullable(),
      phone: z.string(),
      consent: z.boolean(),
      arrangement: z.string(),
      suppressed: z.boolean(),
      status: helpStatus,
      version: z.number().int().nonnegative(),
      receivedAt: z.string(),
      updatedAt: z.string().nullable(),
    }),
  ),
});
export type HelpQueue = z.infer<typeof helpQueue>;
export const helpReceipt = z.object({
  id: z.uuid(),
  campaignId: z.uuid(),
  requestId: z.uuid(),
  status: helpStatus,
  version: z.number().int().positive(),
});
