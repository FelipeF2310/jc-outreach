import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase } from "../src/server/postgres";
import { migrateRetention } from "../src/server/migrate-retention";
import { enableRetentionSchedule } from "../src/server/retention-schedule";
import { safeConnectionFailure } from "../src/server/owner-preflight";

let stage = "configuration";
async function main() {
  const scheduling = process.argv[3] === "--enable-schedule";
  if (
    process.argv[2] !== "--password-stdin" ||
    process.argv.length !== (scheduling ? 4 : 3) ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw Error("Explicit synthetic operator action required");
  console.info(
    `Synthetic retention ${scheduling ? "schedule setup" : "update"} started: ${new Date().toISOString()}`,
  );
  stage = "password_input";
  const password = await readOperatorPassword(process.stdin);
  stage = "certificate_file";
  const ca = await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8");
  stage = "connection_configuration";
  const pool = new Pool(
    operatorConnection(
      process.env.JCO_MIGRATION_DATABASE_URL ?? "",
      process.env.JCO_SUPABASE_URL ?? "",
      password,
      ca,
    ),
  );
  pool.on("error", () => {});
  try {
    stage = "owner_authentication_and_tls";
    const connection = await pool.connect();
    connection.release();
    console.info("Owner connection authentication and verified TLS passed.");
    const db = postgresDatabase(pool);
    if (scheduling) {
      stage = "retention_schedule_setup";
      await enableRetentionSchedule(db);
      console.info(
        "Synthetic retention schedule configured. The worker will permanently delete campaign records after their existing deadlines. A completed scheduled run must still be verified.",
      );
    } else {
      stage = "retention_migration_transaction";
      await migrateRetention(db);
      console.info(
        "Synthetic retention database update completed. Existing campaigns, links, visits, reports and passwords preserved. No campaigns were deleted and no deletion schedule was enabled.",
      );
    }
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Retention setup failed: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "No connection details are logged. Do not reset data. Schedule setup requires the retention update, the Cron module, no already-expired campaigns, and no conflicting job. Share only this sanitized output.",
  );
  process.exitCode = 1;
});
