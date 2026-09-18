import type { NextRequest } from "next/server";
import type { Database } from "./db-contract";
import { retentionRequest, retentionStatus } from "../lib/retention-contracts";
import { DomainError } from "../lib/contracts";
import { requireHostedReader } from "./hosted-campaigns";
import { requireAdministrator, type adminAuthContext } from "./admin-auth";
import type { AdminConfig } from "./admin-config";
import { readOperation } from "./http";
import { hostedDatabase } from "./postgres";

export async function readRetentionStatus(db: Database, input: unknown) {
  const parsed = retentionRequest.safeParse(input);
  if (!parsed.success) throw new DomainError(400, "Choose a valid campaign.");
  return db.transaction(async (tx) => {
    await requireHostedReader(tx);
    const available = await tx.query<{ ready: boolean }>(
      "SELECT to_regprocedure('outreach.retention_status(uuid)') IS NOT NULL AS ready",
    );
    if (!available.rows[0]?.ready) return { ready: false as const };
    const result = await tx.query<{ status: unknown }>(
      "SELECT outreach.retention_status($1) AS status",
      [parsed.data.campaignId],
    );
    const status = retentionStatus.parse(result.rows[0]?.status);
    if (
      status.selected &&
      status.selected.campaignId !== parsed.data.campaignId
    )
      throw Error("Retention scope mismatch");
    return status;
  });
}
export async function readAdministratorRetention(
  request: NextRequest,
  context: ReturnType<typeof adminAuthContext>,
  config: AdminConfig,
  database = hostedDatabase,
) {
  await requireAdministrator(context.client, config);
  return {
    retention: await readRetentionStatus(
      database(),
      await readOperation(request),
    ),
  };
}
