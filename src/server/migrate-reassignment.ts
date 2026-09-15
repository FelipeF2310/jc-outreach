import type { Database } from "./db-contract";
import { migrateCorrectionQueue } from "./migrate-correction-queue";
import { migrate } from "./migrate";
export async function migrateReassignment(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await migrateCorrectionQueue(nested);
    await migrate(nested, ["010_reassignment.sql"]);
  });
}
