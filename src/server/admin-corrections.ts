import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  correctionAdminRequest,
  correctionQueue,
  correctionReceipt,
} from "../lib/correction-admin-contracts";
import { DomainError } from "../lib/contracts";
import type { Database } from "./db-contract";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { hostedDatabase } from "./postgres";
import { readOperation } from "./http";
import { requireHostedReader } from "./hosted-campaigns";

export async function correctionAdmin(
  db: Database,
  input: unknown,
  actor: string,
) {
  const parsed = correctionAdminRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(
      400,
      "Choose a valid campaign, correction report and status.",
    );
  const request = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      await requireHostedReader(tx);
      const available = await tx.query<{ ready: boolean }>(
        "SELECT to_regprocedure('outreach.correction_queue(uuid)') IS NOT NULL AND to_regprocedure('outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid)') IS NOT NULL AS ready",
      );
      if (!available.rows[0]?.ready) {
        if (request.action !== "list")
          throw new DomainError(
            503,
            "Resident correction review needs its database update.",
          );
        return {
          queue: { campaignId: request.campaignId, ready: false, reports: [] },
        };
      }
      let receipt;
      if (request.action === "update") {
        const result = await tx.query<{ receipt: unknown }>(
          "SELECT outreach.update_correction_status($1,$2,$3,$4,$5,$6) AS receipt",
          [
            request.id,
            request.campaignId,
            request.reportId,
            request.expectedVersion,
            request.status,
            actor,
          ],
        );
        receipt = correctionReceipt.parse(result.rows[0]?.receipt);
      }
      const result = await tx.query<{ queue: unknown }>(
        "SELECT outreach.correction_queue($1) AS queue",
        [request.campaignId],
      );
      const queue = correctionQueue.parse(result.rows[0]?.queue);
      if (queue.campaignId !== request.campaignId)
        throw Error("Queue scope mismatch");
      return { queue, ...(receipt ? { receipt } : {}) };
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "JC404")
      throw new DomainError(
        404,
        "This campaign or correction report is unavailable or expired.",
      );
    if (code === "JC409")
      throw new DomainError(
        409,
        "This request changed or the status transition is no longer available. Refresh the queue before trying again.",
      );
    if (code === "JC422")
      throw new DomainError(422, "This status update is invalid.");
    if (code === "JC503" || code === "42883")
      throw new DomainError(
        503,
        "Resident correction review needs its database update.",
      );
    throw error;
  }
}
export async function manageAdministratorCorrection(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  const administrator = await requireAdministrator(context.client, config);
  const input = await readOperation(request);
  return correctionAdmin(database(), input, administrator.id);
}
