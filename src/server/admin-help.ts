import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  helpAdminRequest,
  helpQueue,
  helpReceipt,
} from "../lib/help-admin-contracts";
import { DomainError } from "../lib/contracts";
import type { Database } from "./db-contract";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { hostedDatabase } from "./postgres";
import { readOperation } from "./http";
import { requireHostedReader } from "./hosted-campaigns";

export async function helpAdmin(db: Database, input: unknown, actor: string) {
  const parsed = helpAdminRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(
      400,
      "Choose a valid campaign, help request and status.",
    );
  const request = parsed.data;
  try {
    return await db.transaction(async (tx) => {
      await requireHostedReader(tx);
      const available = await tx.query<{ ready: boolean }>(
        "SELECT to_regprocedure('outreach.help_queue(uuid)') IS NOT NULL AND to_regprocedure('outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid)') IS NOT NULL AS ready",
      );
      if (!available.rows[0]?.ready) {
        if (request.action !== "list")
          throw new DomainError(
            503,
            "Application-help review needs its database update.",
          );
        return {
          queue: { campaignId: request.campaignId, ready: false, requests: [] },
        };
      }
      let receipt;
      if (request.action === "update") {
        const result = await tx.query<{ receipt: unknown }>(
          "SELECT outreach.update_help_status($1,$2,$3,$4,$5,$6) AS receipt",
          [
            request.id,
            request.campaignId,
            request.requestId,
            request.expectedVersion,
            request.status,
            actor,
          ],
        );
        receipt = helpReceipt.parse(result.rows[0]?.receipt);
      }
      const result = await tx.query<{ queue: unknown }>(
        "SELECT outreach.help_queue($1) AS queue",
        [request.campaignId],
      );
      const queue = helpQueue.parse(result.rows[0]?.queue);
      if (queue.campaignId !== request.campaignId)
        throw Error("Queue scope mismatch");
      return { queue, ...(receipt ? { receipt } : {}) };
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
    if (code === "JH404")
      throw new DomainError(
        404,
        "This campaign or help request is unavailable or expired.",
      );
    if (code === "JH409")
      throw new DomainError(
        409,
        "This request changed or the status transition is no longer available. Refresh the queue before trying again.",
      );
    if (code === "JH422")
      throw new DomainError(422, "This status update is invalid.");
    if (code === "JH503" || code === "42883")
      throw new DomainError(
        503,
        "Application-help review needs its database update.",
      );
    throw error;
  }
}
export async function manageAdministratorHelp(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  const administrator = await requireAdministrator(context.client, config);
  const input = await readOperation(request);
  return helpAdmin(database(), input, administrator.id);
}
