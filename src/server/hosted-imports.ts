import { z } from "zod";
import type { Database } from "./db-contract";
import type { ImportReceipt } from "../lib/import-contracts";
import { DomainError } from "../lib/contracts";
import { rehearsalCsv } from "./import-rehearsal";
import { validateImport } from "./import-validation";

export const hostedImportRequest = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("preview"),
    campaignId: z.uuid(),
    caseId: z.string().max(80),
  }),
  z.strictObject({
    action: z.literal("finalize"),
    campaignId: z.uuid(),
    caseId: z.string().max(80),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  }),
]);

export async function hostedImport(
  db: Database,
  input: unknown,
  actor: string,
) {
  const parsed = hostedImportRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(
      400,
      "Only built-in synthetic examples are accepted. File uploads are disabled.",
    );
  const request = parsed.data;
  // Resolve approved bytes server-side and repeat all population/grouping checks.
  const { preview } = validateImport(rehearsalCsv(request.caseId));
  try {
    return await db.transaction(async (tx) => {
      const marker = await tx.query<{ stage: string; role: string }>(
        "SELECT stage,current_user AS role FROM outreach.deployment WHERE singleton",
      );
      if (
        marker.rows[0]?.stage !== "synthetic-preview" ||
        marker.rows[0]?.role !== "jco_admin_reader"
      )
        throw new Error("Unexpected import runtime or stage.");
      const campaign = await tx.query(
        "SELECT id FROM outreach.campaigns WHERE id=$1 AND deletion_at>now() AND end_at IS NOT NULL AND created_by IS NOT NULL",
        [request.campaignId],
      );
      if (!campaign.rows.length)
        throw new DomainError(404, "Campaign unavailable or expired.");
      if (request.action === "preview") return { preview };
      if (!preview.valid || !preview.digest)
        throw new DomainError(
          422,
          "Import rejected. No records were imported.",
        );
      if (request.digest !== preview.digest)
        throw new DomainError(
          409,
          "Preview changed. Validate the example again before finalizing.",
        );
      const saved = await tx.query<{ receipt: ImportReceipt }>(
        "SELECT outreach.finalize_synthetic_import($1,$2,$3) AS receipt",
        [request.campaignId, preview.digest, actor],
      );
      if (!saved.rows[0]?.receipt)
        throw new Error("Import receipt unavailable.");
      return { receipt: saved.rows[0].receipt };
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "42883")
      throw new DomainError(
        503,
        "Synthetic imports need their database update. No import was confirmed. Contact the website owner.",
      );
    if (code === "JI001")
      throw new DomainError(404, "Campaign unavailable or expired.");
    if (code === "JI002")
      throw new DomainError(
        409,
        "The reviewed fixture does not match the database version. Contact the website owner.",
      );
    if (code === "JI003")
      throw new DomainError(
        409,
        "This campaign is already populated. Its source cannot be replaced.",
      );
    throw error;
  }
}
