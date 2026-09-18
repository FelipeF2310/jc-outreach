import type { Database } from "./db-contract";
import { migrate } from "./migrate";
import { isHostedStage } from "./hosted-stage";

const migrations = [
  "002_imports.sql",
  "003_campaign_creation.sql",
  "004_synthetic_import.sql",
  "005_assignment_preparation.sql",
  "006_hosted_field.sql",
  "007_link_labels.sql",
  "008_help_queue.sql",
  "009_correction_queue.sql",
  "010_reassignment.sql",
  "011_completion_data.sql",
  "012_hosted_completion.sql",
  "013_retention.sql",
  "014_csv_import.sql",
  "015_live_campaigns.sql",
];

/** Operator-only additive install. Never changes the deployment stage or data. */
export async function migrateLive(db: Database) {
  return db.transaction(async (tx) => {
    const marker = await tx.query<{ stage: string }>(
      "SELECT stage FROM outreach.deployment WHERE singleton",
    );
    if (!isHostedStage(marker.rows[0]?.stage))
      throw Error("Reviewed deployment required");
    await migrate({ ...tx, transaction: async (work) => work(tx) }, migrations);
  });
}
