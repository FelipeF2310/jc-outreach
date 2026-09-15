import type { Database, SqlConnection } from "./db-contract";
import { z } from "zod";
import { DomainError } from "../lib/contracts";
import type { ImportReceipt } from "../lib/import-contracts";

const campaignRequest = z.strictObject({
  id: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\u0000-\u001f\u007f]+$/),
  endDate: z.iso
    .date()
    .refine((date) => date >= "2000-01-01" && date <= "9998-12-31"),
});

async function requireHostedReader(tx: SqlConnection) {
  const marker = await tx.query<{ stage: string; role: string }>(
    "SELECT stage, current_user AS role FROM outreach.deployment WHERE singleton = true",
  );
  if (
    marker.rows[0]?.stage !== "synthetic-preview" ||
    marker.rows[0]?.role !== "jco_admin_reader"
  )
    throw new Error(
      "Database stage or runtime role does not match the reviewed configuration.",
    );
}

export async function createHostedCampaign(
  db: Database,
  input: unknown,
  administratorId: string,
) {
  const parsed = campaignRequest.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(administratorId).success)
    throw new DomainError(
      400,
      "Enter a synthetic campaign name and a valid end date.",
    );
  try {
    return await db.transaction(async (tx) => {
      await requireHostedReader(tx);
      const { rows } = await tx.query<{
        id: string;
        name: string;
        end_at: Date;
        deletion_at: Date;
      }>(
        "SELECT * FROM outreach.create_synthetic_campaign($1::uuid,$2::text,$3::date,$4::uuid)",
        [
          parsed.data.id,
          parsed.data.name,
          parsed.data.endDate,
          administratorId,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("Campaign save returned no receipt.");
      return {
        id: row.id,
        name: row.name,
        endAt: row.end_at.toISOString(),
        deletionAt: row.deletion_at.toISOString(),
      };
    });
  } catch (error) {
    const code =
      typeof error === "object" && error && "code" in error
        ? error.code
        : undefined;
    if (code === "JC001" || code === "22008" || code === "22007")
      throw new DomainError(
        400,
        "Enter a valid campaign end date that has not passed in Jersey City.",
      );
    if (code === "JC002")
      throw new DomainError(
        409,
        "This save conflicts with an existing campaign. Reload the campaign list before starting another.",
      );
    if (code === "42883")
      throw new DomainError(
        503,
        "Campaign creation needs its database update. Your sign-in and campaign list still work.",
      );
    throw error;
  }
}

export async function listHostedCampaigns(db: Database) {
  return db.transaction(async (tx) => {
    await requireHostedReader(tx);
    const ready = await tx.query<{ ready: boolean }>(
      "SELECT to_regprocedure('outreach.synthetic_import_status()') IS NOT NULL AS ready",
    );
    const importReady = ready.rows[0]?.ready === true;
    const { rows } = await tx.query<{
      id: string;
      name: string;
      end_at: Date | null;
      deletion_at: Date;
      import_receipt: ImportReceipt | null;
    }>(
      `SELECT c.id,c.name,(to_jsonb(c)->>'end_at')::timestamptz AS end_at,c.deletion_at, ${importReady ? "i.receipt" : "NULL::jsonb"} AS import_receipt
       FROM outreach.campaigns c ${importReady ? "LEFT JOIN outreach.synthetic_import_status() i ON i.campaign_id=c.id" : ""}
       WHERE c.deletion_at > now() ORDER BY c.deletion_at,c.id LIMIT 100`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      endAt: row.end_at?.toISOString() ?? null,
      deletionAt: row.deletion_at.toISOString(),
      importReceipt: row.import_receipt ?? null,
      importReady,
    }));
  });
}
