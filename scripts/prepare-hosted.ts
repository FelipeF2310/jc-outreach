import { Pool } from "pg";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { prepareHosted } from "../src/server/prepare-hosted";

async function main() {
  if (
    process.argv[2] !== "--synthetic-preview" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    !process.env.JCO_MIGRATION_DATABASE_URL
  )
    throw new Error("Explicit synthetic bootstrap configuration required.");
  const pool = new Pool(
    postgresOptions(
      process.env.JCO_MIGRATION_DATABASE_URL,
      process.env.JCO_DATABASE_CA,
    ),
  );
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
