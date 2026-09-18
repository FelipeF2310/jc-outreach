import { z } from "zod";
import { DomainError } from "../lib/contracts";
import type { ImportPreview, ImportReceipt } from "../lib/import-contracts";
import type { Database } from "./db-contract";
import { validateImport } from "./import-validation";

// Raw HTTP body, not JSON/base64/multipart. Below Vercel's 4.5 MB limit.
export const CSV_BODY_BYTES = 4 * 1024 * 1024;
export const CSV_PREVIEW_HOUSEHOLDS = 100;
// A household-count cap alone is insufficient: a malformed source can group
// thousands of long names into one door. Bound serialized preview data as well.
export const CSV_PREVIEW_HOUSEHOLD_BYTES = 256 * 1024;

/** Internal transport primitive. Authorization and ingress approval MUST run
 * before this function. No route exposes it until the hosted gate is closed. */
export async function readCsvBody(request: Request): Promise<Uint8Array> {
  if (
    !/^text\/csv(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new DomainError(415, "Use UTF-8 CSV with Content-Type text/csv.");
  if (
    request.headers.has("content-encoding") &&
    request.headers.get("content-encoding") !== "identity"
  )
    throw new DomainError(415, "Compressed CSV requests are not accepted.");
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > CSV_BODY_BYTES)
  )
    throw new DomainError(413, "Use a nonempty CSV no larger than 4 MiB.");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(400, "The CSV is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CSV_BODY_BYTES)
        throw new DomainError(413, "Use a nonempty CSV no larger than 4 MiB.");
      chunks.push(value);
    }
    if (!size) throw new DomainError(400, "The CSV is empty.");
    return Buffer.concat(chunks, size);
  } catch (error) {
    // Stream and cancellation exceptions may contain filenames/source values.
    await reader.cancel().catch(() => {});
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      400,
      "CSV transfer was interrupted. Select the file and retry.",
    );
  } finally {
    reader.releaseLock();
  }
}

export const csvImportAction = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("preview"), campaignId: z.uuid() }),
  z.strictObject({
    action: z.literal("finalize"),
    campaignId: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    confirmed: z.literal(true),
  }),
]);

export type CsvPreview = ImportPreview & {
  previewHouseholdLimit: number;
  previewHouseholdByteLimit: number;
  previewTruncated: boolean;
};

/** Authorized-caller-only service, intentionally not registered as an HTTP route.
 * Reparse exact bytes on every request; never persist source files/previews. */
export async function importCsvBytes(
  db: Database,
  metadata: unknown,
  bytes: Uint8Array,
  actor: string,
): Promise<{ preview: CsvPreview } | { receipt: ImportReceipt }> {
  const parsed = csvImportAction.safeParse(metadata);
  if (!parsed.success || !z.uuid().safeParse(actor).success)
    throw new DomainError(400, "Invalid import request.");
  if (!bytes.length || bytes.length > CSV_BODY_BYTES)
    throw new DomainError(413, "Use a nonempty CSV no larger than 4 MiB.");
  const input = parsed.data;
  const { preview, rows } = validateImport(bytes);
  try {
    return await db.transaction(async (tx) => {
      const scope = await tx.query<{ allowed: boolean }>(
        `SELECT (
        current_user='jco_admin_reader' AND EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview')
        AND EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=$1 AND deletion_at>now() AND end_at IS NOT NULL AND created_by IS NOT NULL)
      ) AS allowed`,
        [input.campaignId],
      );
      if (scope.rows[0]?.allowed !== true)
        throw new DomainError(404, "Campaign unavailable or expired.");
      if (input.action === "preview") {
        const households: ImportPreview["households"] = [];
        let size = 2;
        for (const household of preview.households) {
          const bytes = Buffer.byteLength(JSON.stringify(household)) + 1;
          if (
            households.length === CSV_PREVIEW_HOUSEHOLDS ||
            size + bytes > CSV_PREVIEW_HOUSEHOLD_BYTES
          )
            break;
          households.push(household);
          size += bytes;
        }
        const bounded: CsvPreview = {
          ...preview,
          households,
          previewHouseholdLimit: CSV_PREVIEW_HOUSEHOLDS,
          previewHouseholdByteLimit: CSV_PREVIEW_HOUSEHOLD_BYTES,
          previewTruncated: preview.households.length > households.length,
        };
        return { preview: bounded };
      }
      if (!preview.valid || !preview.digest || !preview.counts)
        throw new DomainError(
          422,
          "Import rejected. Correct the source file and repeat validation. No records were imported.",
        );
      if (input.digest !== preview.digest)
        throw new DomainError(
          409,
          "The source changed after preview. Validate the current file before finalizing.",
        );
      const result = await tx.query<{ receipt: ImportReceipt }>(
        "SELECT outreach.finalize_csv_import($1,$2,$3::jsonb,$4) AS receipt",
        [input.campaignId, preview.digest, JSON.stringify(rows), actor],
      );
      const receipt = result.rows[0]?.receipt;
      if (
        !receipt ||
        receipt.campaignId !== input.campaignId ||
        receipt.counts?.people !== preview.counts.people ||
        receipt.counts?.households !== preview.counts.households ||
        receipt.counts?.buildings !== preview.counts.buildings
      )
        throw new DomainError(
          503,
          "Import receipt could not be confirmed. Retry the same source.",
        );
      return { receipt };
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    if (code === "JC001")
      throw new DomainError(404, "Campaign unavailable or expired.");
    if (code === "JC002")
      throw new DomainError(
        422,
        "Database validation rejected the import. Review the source file.",
      );
    if (code === "JC003")
      throw new DomainError(
        409,
        "This campaign already has an import or a different finalized request. Refresh its receipt.",
      );
    // Never expose constraint DETAIL, parser values, SQL text or server messages.
    throw new DomainError(
      503,
      "Import could not be confirmed. Retry the same source or contact the organizer.",
    );
  }
}
