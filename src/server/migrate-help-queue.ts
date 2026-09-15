import type { Database } from "./db-contract";
import { migrateLinkLabels } from "./migrate-link-labels";
import { migrate } from "./migrate";
export async function migrateHelpQueue(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await migrateLinkLabels(nested);
    await migrate(nested, ["008_help_queue.sql"]);
  });
}
