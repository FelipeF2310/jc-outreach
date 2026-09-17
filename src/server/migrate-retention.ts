import type { Database } from "./db-contract";
import { migrateCompletion } from "./migrate-completion";
import { migrate } from "./migrate";

/** Operator-only preparation: does not execute deletion or enable the schedule. */
export async function migrateRetention(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await migrateCompletion(nested);
    await migrate(nested, ["013_retention.sql"]);
  });
}
