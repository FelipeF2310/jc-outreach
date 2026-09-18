import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase } from "../src/server/postgres";
import {
  ownerPreflight,
  safeConnectionFailure,
} from "../src/server/owner-preflight";

let stage = "configuration";
async function main() {
  console.info(`Read-only owner check started: ${new Date().toISOString()}`);
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--password-stdin" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw new Error("Invalid configuration.");
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
    stage = "read_only_metadata";
    console.info(
      JSON.stringify(await ownerPreflight(postgresDatabase(pool)), null, 2),
    );
    console.info(
      "Read-only check completed. The migration was NOT run; no database settings or records were changed.",
    );
  } finally {
    await pool.end();
  }
}
main().catch((error: unknown) => {
  console.error(
    `Read-only check failed: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "No passwords, connection strings or raw database errors are printed. The migration was NOT run.",
  );
  process.exitCode = 1;
});
