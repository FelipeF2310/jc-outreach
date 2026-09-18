import type { Database } from "./db-contract";
import { randomUUID } from "node:crypto";
import { DomainError } from "../lib/contracts";
import type { ImportCounts, ImportReceipt } from "../lib/import-contracts";
import { buildingKey, validateImport } from "./import-validation";

/** Internal service: callers must authorize the administrator and campaign first. */
export async function finalizeImport(
  db: Database,
  campaignId: string,
  bytes: Uint8Array,
  previewDigest: string,
): Promise<ImportReceipt> {
  // Re-parse the source, never trust a client-provided grouping or validated flag.
  const { preview, rows } = validateImport(bytes);
  if (!preview.valid || !preview.counts || !preview.digest)
    throw new DomainError(
      422,
      "Import rejected. Correct the source file and repeat validation. No campaign records were imported.",
    );
  if (previewDigest !== preview.digest)
    throw new DomainError(
      409,
      "The source changed after preview. Validate the current file before finalizing.",
    );
  return db.transaction(async (tx) => {
    const campaign = await tx.query<{ deletion_at: Date }>(
      "SELECT deletion_at FROM outreach.campaigns WHERE id=$1 FOR UPDATE",
      [campaignId],
    );
    if (!campaign.rows[0]) throw new DomainError(404, "Campaign unavailable.");
    if (campaign.rows[0].deletion_at <= new Date())
      throw new DomainError(410, "Campaign has expired.");
    const existing = await tx.query<{
      id: string;
      source_digest: string;
      counts: ImportCounts;
      finalized_at: Date;
    }>(
      "SELECT id,source_digest,counts,finalized_at FROM outreach.imports WHERE campaign_id=$1",
      [campaignId],
    );
    if (existing.rows[0]) {
      const saved = existing.rows[0];
      if (saved.source_digest !== preview.digest)
        throw new DomainError(
          409,
          "This campaign already has a finalized import. Its source cannot be replaced.",
        );
      return {
        importId: saved.id,
        campaignId,
        counts: saved.counts,
        finalizedAt: saved.finalized_at.toISOString(),
      };
    }
    const populated = await tx.query(
      "SELECT id FROM outreach.households WHERE campaign_id=$1 UNION ALL SELECT id FROM outreach.assignments WHERE campaign_id=$1 LIMIT 1",
      [campaignId],
    );
    if (populated.rows.length)
      throw new DomainError(
        409,
        "This campaign already has field records. Import into an empty campaign before assigning doors.",
      );
    const importId = randomUUID();
    const saved = await tx.query<{ finalized_at: Date }>(
      "INSERT INTO outreach.imports(campaign_id,id,source_digest,counts) VALUES ($1,$2,$3,$4) RETURNING finalized_at",
      [campaignId, importId, preview.digest, JSON.stringify(preview.counts)],
    );
    const buildings = new Map<string, string>(),
      households = new Map<string, string>();
    for (const row of rows) {
      const key = buildingKey(row);
      if (!buildings.has(key)) {
        const id = randomUUID();
        buildings.set(key, id);
        await tx.query(
          "INSERT INTO outreach.buildings(id,campaign_id,grouping_key,address,zip,ward) VALUES ($1,$2,$3,$4,$5,$6)",
          [id, campaignId, key, row["Property Location"], row.Zip, row.Ward],
        );
      }
      const householdKey = row["Household Key"];
      if (!households.has(householdKey)) {
        const id = randomUUID();
        households.set(householdKey, id);
        await tx.query(
          "INSERT INTO outreach.households(id,campaign_id,building_id,address,unit,source_key) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            id,
            campaignId,
            buildings.get(key),
            row["Property Location"],
            row["Unit (verified)"],
            householdKey,
          ],
        );
      }
      const personId = randomUUID();
      await tx.query(
        "INSERT INTO outreach.people(id,household_id,first_name,last_name) VALUES ($1,$2,$3,$4)",
        [
          personId,
          households.get(householdKey),
          row["First Name"],
          row["Last Name"],
        ],
      );
      await tx.query(
        `INSERT INTO outreach.import_people(person_id,campaign_id,source_id,residence_address,zip,ward,block,lot,qual,property_location,verified_unit,tier,household_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          personId,
          campaignId,
          row.VANID,
          row["Residence Address"],
          row.Zip,
          row.Ward,
          row.Block,
          row.Lot,
          row.Qual,
          row["Property Location"],
          row["Unit (verified)"],
          row.Tier,
          householdKey,
        ],
      );
    }
    return {
      importId,
      campaignId,
      counts: preview.counts!,
      finalizedAt: saved.rows[0].finalized_at.toISOString(),
    };
  });
}
