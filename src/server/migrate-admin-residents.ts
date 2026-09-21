import type { Database } from "./db-contract";
import { migrateLive } from "./migrate-live";
import { migrate } from "./migrate";

/** Explicit operator upgrade of an existing live-capable installation only. */
export async function migrateAdminResidents(db: Database) {
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ ready: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM outreach.schema_migrations WHERE name='015_live_campaigns.sql') AS ready",
    );
    if (existing.rows[0]?.ready !== true)
      throw Error("Existing live-capable installation required.");
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    // Verify all previous checksums inside the same transaction. No stage switch.
    await migrateLive(nested);
    await migrate(nested, ["016_admin_residents.sql"]);
  });
}
