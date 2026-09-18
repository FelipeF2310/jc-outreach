import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { prepareHosted } from "../src/server/prepare-hosted";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";

async function main() {
  if (
    process.argv[2] !== "--synthetic-preview" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    !process.env.JCO_MIGRATION_DATABASE_URL
  )
    throw new Error("Explicit synthetic bootstrap configuration required.");
  const passwordStdin = process.argv[3] === "--password-stdin";
  if (process.argv.length > (passwordStdin ? 4 : 3))
    throw new Error("Unexpected operator arguments.");
  const options = passwordStdin
    ? operatorConnection(
        process.env.JCO_MIGRATION_DATABASE_URL,
        process.env.JCO_SUPABASE_URL ?? "",
        await readOperatorPassword(process.stdin),
        await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8"),
      )
    : postgresOptions(
        process.env.JCO_MIGRATION_DATABASE_URL,
        process.env.JCO_DATABASE_CA,
      );
  const pool = new Pool(options);
  try {
    await prepareHosted(postgresDatabase(pool));
    console.info(
      "Empty synthetic database prepared. Configure the reader password outside source control before connecting the app.",
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Synthetic database preparation failed. No connection details are logged. Check configuration and database-owner access; do not reset existing data.",
  );
  process.exitCode = 1;
});
