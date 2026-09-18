import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase } from "../src/server/postgres";
import { migrateAssignments } from "../src/server/migrate-assignments";
import { safeConnectionFailure } from "../src/server/owner-preflight";

let stage = "configuration";
async function main() {
  console.info(
    `Synthetic assignment database update started: ${new Date().toISOString()}`,
  );
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--password-stdin" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw new Error("Explicit synthetic migration required.");
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
    stage = "assignment_migration_transaction";
    await migrateAssignments(postgresDatabase(pool));
    console.info(
      "Synthetic assignment database update completed. Existing campaigns, households and reader password preserved. No assignments or volunteer links were created by this update.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Synthetic assignment update failed: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "Assignment database update did not complete. No connection details are logged. Do not reset or delete existing data.",
  );
  process.exitCode = 1;
});
