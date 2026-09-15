import type { Database } from "./db-contract";
import { migrateField } from "./migrate-field";
import { migrate } from "./migrate";

export async function migrateLinkLabels(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    // Existing migration verifies synthetic stage and holds the shared migration lock.
    await migrateField(nested);
    await migrate(nested, ["007_link_labels.sql"]);
  });
}
