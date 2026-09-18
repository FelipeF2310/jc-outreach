import { DomainError } from "@/lib/contracts";
import { endpoint, readOperation } from "@/server/http";
import {
  assignRehearsal,
  createRehearsal,
  rehearsalCsv,
  rehearsalRequest,
  requireRehearsal,
} from "@/server/import-rehearsal";
import { validateImport } from "@/server/import-validation";
import { finalizeImport } from "@/server/import-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return endpoint(
    request,
    async (db) => {
      const rows = await db.query<{
        campaign_id: string;
        end_at: Date;
        deletion_at: Date;
        import_id: string | null;
        counts: import("@/lib/import-contracts").ImportCounts | null;
        finalized_at: Date | null;
      }>(`SELECT r.campaign_id,r.end_at,c.deletion_at,i.id AS import_id,i.counts,i.finalized_at
      FROM outreach.import_rehearsals r JOIN outreach.campaigns c ON c.id=r.campaign_id
      LEFT JOIN outreach.imports i ON i.campaign_id=r.campaign_id WHERE c.deletion_at>now() ORDER BY r.end_at DESC LIMIT 20`);
      return rows.rows.map((row) => ({
        campaignId: row.campaign_id,
        endAt: row.end_at.toISOString(),
        deletionAt: row.deletion_at.toISOString(),
        receipt:
          row.import_id && row.counts && row.finalized_at
            ? {
                campaignId: row.campaign_id,
                importId: row.import_id,
                counts: row.counts,
                finalizedAt: row.finalized_at.toISOString(),
              }
            : null,
      }));
    },
    true,
  );
}

export async function POST(request: Request) {
  return endpoint(
    request,
    async (db) => {
      const parsed = rehearsalRequest.safeParse(await readOperation(request));
      if (!parsed.success)
        throw new DomainError(
          400,
          "Only built-in synthetic import examples are accepted. File uploads are disabled.",
        );
      const input = parsed.data;
      if (input.action === "create")
        return createRehearsal(db, input.campaignId);
      await requireRehearsal(db, input.campaignId);
      if (input.action === "assignment")
        return assignRehearsal(db, input.campaignId);
      const bytes = rehearsalCsv(input.caseId);
      if (input.action === "preview") return validateImport(bytes).preview;
      return finalizeImport(db, input.campaignId, bytes, input.digest);
    },
    true,
  );
}
