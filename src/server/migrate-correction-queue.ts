import type { Database } from "./db-contract";
import { migrateHelpQueue } from "./migrate-help-queue";
import { migrate } from "./migrate";
export async function migrateCorrectionQueue(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await migrateHelpQueue(nested);
    await migrate(nested, ["009_correction_queue.sql"]);
  });
}
