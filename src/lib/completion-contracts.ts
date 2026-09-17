import { z } from "zod";
const ids = z
  .array(z.uuid())
  .max(2000)
  .refine((values) => new Set(values).size === values.length);
export const completionReportSchema = z
  .strictObject({
    id: z.uuid(),
    assignmentId: z.uuid(),
    deviceId: z.uuid(),
    version: z.number().int().min(1).max(999999999),
    state: z.enum(["working", "finished"]),
    operationIds: ids,
    pendingIds: ids,
    createdAt: z.iso.datetime(),
  })
  .refine((report) =>
    report.pendingIds.every((id) => report.operationIds.includes(id)),
  );
export type CompletionReport = z.infer<typeof completionReportSchema>;
export const completionReceiptSchema = z.strictObject({
  reportId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: true }),
});
export type CompletionReceipt = z.infer<typeof completionReceiptSchema>;
export type CompletionSnapshot = {
  completionReady: true;
  devices: {
    deviceId: string;
    label: string | null;
    state: "working" | "finished";
    version: number;
    receivedAt: string;
    declaredCount: number;
    pendingReportedCount: number;
    missingCount: number;
    additionalActivity: boolean;
  }[];
};
