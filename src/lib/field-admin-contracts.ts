import { z } from "zod";
import type { Outcome } from "./contracts";

export const fieldAdminRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status"), assignmentId: z.uuid() }),
  z.strictObject({
    action: z.literal("issue"),
    assignmentId: z.uuid(),
    id: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("revoke"),
    assignmentId: z.uuid(),
    id: z.uuid(),
    confirmed: z.literal(true),
  }),
]);
export type FieldAdminRequest = z.infer<typeof fieldAdminRequest>;
export type FieldSnapshot = {
  assignmentId: string;
  eventEndsAt: string;
  uploadEndsAt: string;
  deletionAt: string;
  credentials: {
    id: string;
    issuedAt: string;
    revoked: boolean;
    revokedAt: string | null;
  }[];
  visits: {
    id: string;
    address: string;
    unit: string;
    result: Outcome;
    receivedAt: string;
  }[];
  counts: { attempts: number; repeats: number; conversations: number };
  buildingFailures: number;
  helpRequests: number;
  latestReceivedAt: string | null;
};
