import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { readOperatorPassword } from "../src/server/operator-connection";
import {
  readerConfiguration,
  readPrivateConfiguration,
  savePrivateConfiguration,
} from "../src/server/reader-config";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { verifyReader } from "../src/server/verify-reader";

async function main() {
  const checkOnly = process.argv[2] === "--check-empty";
  if (
    process.argv.length !== 3 ||
    (!checkOnly && process.argv[2] !== "--password-stdin")
  )
    throw new Error("Hidden reader-password input required.");
  const path = `${process.cwd()}/.env.local`;
  const previous = await readPrivateConfiguration(path);
  const configuration = readerConfiguration(
    previous,
    process.env.JCO_MIGRATION_DATABASE_URL ?? "",
    checkOnly
      ? "placeholder-for-local-validation"
      : await readOperatorPassword(process.stdin),
    await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8"),
  );
  if (checkOnly) return;
  const pool = new Pool(
    postgresOptions(configuration.connectionString, configuration.ca),
  );
  pool.on("error", () => {}); // Never print driver objects or connection details.
  try {
    const result = await verifyReader(postgresDatabase(pool));
    await savePrivateConfiguration(path, previous, configuration.source);
    console.info(
      `Restricted reader verified. Active synthetic campaigns: ${result.campaignCount}.`,
    );
    console.info(
      "App database configuration saved privately. Restart the app to use it.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Reader configuration did not complete. No credentials are printed. Check the reader password, connection and permissions; do not reset the database.",
  );
  process.exitCode = 1;
});
