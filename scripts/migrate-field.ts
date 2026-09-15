import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase } from "../src/server/postgres";
import { migrateField } from "../src/server/migrate-field";
import { migrateLinkLabels } from "../src/server/migrate-link-labels";
import { safeConnectionFailure } from "../src/server/owner-preflight";

let stage = "configuration";
const labels = process.argv[3] === "--link-labels";
async function main() {
  console.info(
    `Synthetic ${labels ? "link-label" : "field"} database update started: ${new Date().toISOString()}`,
  );
  if (
    (process.argv.length !== 3 && !(process.argv.length === 4 && labels)) ||
    process.argv[2] !== "--password-stdin" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw Error("Explicit synthetic migration required.");
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
    stage = labels
      ? "link_label_migration_transaction"
      : "field_migration_transaction";
    if (labels) await migrateLinkLabels(postgresDatabase(pool));
    else await migrateField(postgresDatabase(pool));
    console.info(
      labels
        ? "Synthetic link-label database update completed. Existing links, assignments, visits and passwords preserved. No links were issued or revoked."
        : "Synthetic field database update completed. Existing campaigns, assignments, households and reader password preserved. No volunteer links or visits were created by this update.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Synthetic field update failed: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "Field database update did not complete. No connection details are logged. Do not reset or delete existing data.",
  );
  process.exitCode = 1;
});
