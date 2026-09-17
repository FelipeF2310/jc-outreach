import { z } from "zod";

export const retentionRequest = z.strictObject({
  campaignId: z.uuid().nullable(),
});
export const retentionStatus = z.strictObject({
  ready: z.literal(true),
  observedAt: z.string(),
  checkedAt: z.string().nullable(),
  health: z.enum(["not_started", "recent", "stale"]),
  deletedCampaigns: z.number().int().nonnegative(),
  overdueCampaigns: z.number().int().nonnegative(),
  failedCampaigns: z.number().int().nonnegative(),
  oldestDeadline: z.string().nullable(),
  selected: z
    .strictObject({
      campaignId: z.uuid(),
      deletionAt: z.string(),
      openHelpRequests: z.number().int().nonnegative(),
    })
    .nullable(),
});
export const retentionResponse = z.union([
  z.strictObject({ ready: z.literal(false) }),
  retentionStatus,
]);
export type RetentionStatus = z.infer<typeof retentionResponse>;
