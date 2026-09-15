import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase } from "../src/server/postgres";
import { migrateCorrectionQueue } from "../src/server/migrate-correction-queue";
import { safeConnectionFailure } from "../src/server/owner-preflight";
let stage = "configuration";
async function main() {
  console.info(
    `Synthetic correction-queue update started: ${new Date().toISOString()}`,
  );
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--password-stdin" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw Error("Explicit synthetic update required.");
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
    stage = "correction_queue_migration_transaction";
    await migrateCorrectionQueue(postgresDatabase(pool));
    console.info(
      "Synthetic correction-queue database update completed. Existing campaigns, links, visits, reports and passwords preserved. No correction reports or status updates were created.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Correction-queue update failed: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "No connection details are logged. Do not reset or delete existing data.",
  );
  process.exitCode = 1;
});
