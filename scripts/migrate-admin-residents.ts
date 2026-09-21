/** Explicit operator-only upgrade. No import, link issuance or stage change. */
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { isHostedStage } from "../src/server/hosted-stage";
import { safeConnectionFailure } from "../src/server/owner-preflight";
import { migrateAdminResidents } from "../src/server/migrate-admin-residents";
import { verifyReader } from "../src/server/verify-reader";
import { inspectUploadLogging } from "../src/server/upload-safety";
import { verifyAdminResidents } from "../src/server/verify-admin-residents";

let stage = "configuration";
let migrationCommitted = false;
async function main() {
  console.info(
    `Administrator resident-name update started: ${new Date().toISOString()}`,
  );
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--password-stdin" ||
    !isHostedStage(process.env.JCO_HOSTED_STAGE)
  )
    throw Error("Explicit hosted update required.");
  stage = "password_input";
  const password = await readOperatorPassword(process.stdin);
  stage = "certificate_file";
  const ca = await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8");
  stage = "connection_configuration";
  const ownerOptions = operatorConnection(
    process.env.JCO_MIGRATION_DATABASE_URL ?? "",
    process.env.JCO_SUPABASE_URL ?? "",
    password,
    ca,
  );
  const runtimeOptions = postgresOptions(
    process.env.DATABASE_URL ?? "",
    process.env.JCO_DATABASE_CA,
  );
  const ownerTarget = new URL(ownerOptions.connectionString!);
  const runtimeTarget = new URL(runtimeOptions.connectionString!);
  const project = new URL(process.env.JCO_SUPABASE_URL!);
  if (
    runtimeTarget.host !== ownerTarget.host ||
    runtimeTarget.pathname !== ownerTarget.pathname ||
    runtimeTarget.username !==
      `jco_admin_reader.${project.hostname.split(".")[0]}`
  )
    throw Error("Owner and runtime must target the same reviewed project.");
  const runtime = new Pool({ ...runtimeOptions, max: 1 });
  const owner = new Pool({ ...ownerOptions, max: 1 });
  runtime.on("error", () => {});
  owner.on("error", () => {});
  try {
    stage = "runtime_privileges_and_logging";
    const db = postgresDatabase(runtime);
    await db.transaction(async (tx) => {
      await tx.exec("SET TRANSACTION READ ONLY");
      const read = {
        ...tx,
        transaction: async <T>(work: (connection: typeof tx) => Promise<T>) =>
          work(tx),
      };
      await verifyReader(read);
      if (!(await inspectUploadLogging(read)).loggingBaselinePassed)
        throw Error("Logging baseline required.");
    });
    stage = "owner_authentication_and_tls";
    const scope =
      await owner.query(`SELECT current_user='postgres' AND current_user=session_user
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS allowed
      FROM pg_class c WHERE c.oid='outreach.campaigns'::regclass`);
    if (scope.rows[0]?.allowed !== true) throw Error("Owner scope rejected.");
    console.info(
      "Owner authentication, verified TLS and restricted runtime preflight passed.",
    );
    stage = "resident_name_migration_transaction";
    await migrateAdminResidents(postgresDatabase(owner));
    migrationCommitted = true;
    stage = "restricted_read_only_verification";
    const result = await verifyAdminResidents(db);
    console.info(JSON.stringify(result, null, 2));
    console.info(
      "Administrator resident-name database update completed. Existing campaigns, assignments, visits, links, passwords and deadlines preserved. No imports or volunteer links were created.",
    );
    console.info(
      "The compatible website release and administrator visual check are separate steps.",
    );
  } finally {
    await Promise.all([owner.end(), runtime.end()]);
  }
}
main().catch((error: unknown) => {
  console.error(
    `Resident-name update failed: stage=${stage}; category=${safeConnectionFailure(error)}; migrationCommitted=${migrationCommitted}.`,
  );
  console.error(
    "No resident details or connection secrets are printed. Do not reset the database or rerun initialization.",
  );
  process.exitCode = 1;
});
