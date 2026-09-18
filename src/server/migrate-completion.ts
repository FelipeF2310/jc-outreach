import type { Database } from "./db-contract";
import { migrateReassignment } from "./migrate-reassignment";
import { migrate } from "./migrate";
export async function migrateCompletion(db: Database) {
  return db.transaction(async (tx) => {
    const nested = {
      ...tx,
      transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
        work(tx),
    };
    await migrateReassignment(nested);
    await migrate(nested, [
      "011_completion_data.sql",
      "012_hosted_completion.sql",
    ]);
  });
}
