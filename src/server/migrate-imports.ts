import type { Database } from "./db-contract";
import { migrate } from "./migrate";

/** Explicit owner handoff only; never run on requests or application startup. */
export async function migrateImports(db: Database) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73401829)");
    const marker = await tx.query<{ stage: string }>(
      "SELECT stage FROM outreach.deployment WHERE singleton",
    );
    if (marker.rows[0]?.stage !== "synthetic-preview")
      throw new Error("Synthetic deployment required.");
    await migrate({ ...tx, transaction: async (work) => work(tx) }, [
      "002_imports.sql",
      "003_campaign_creation.sql",
      "004_synthetic_import.sql",
    ]);
  });
}
