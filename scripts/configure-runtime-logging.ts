import { readFile, open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import {
  ownerPreflight,
  safeConnectionFailure,
} from "../src/server/owner-preflight";
import { configureRuntimeLogging } from "../src/server/runtime-logging";
import { inspectUploadLogging } from "../src/server/upload-safety";
import { verifyReader } from "../src/server/verify-reader";

let stage = "configuration";
let settingsCommitted = false;
async function main() {
  if (
    process.argv.length !== 4 ||
    process.argv[2] !== "--password-stdin" ||
    process.argv[3] !== "--recycle-idle-runtime" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview" ||
    !process.env.DATABASE_URL
  )
    throw Error("Explicit synthetic owner operation required.");
  console.info(
    `Runtime logging protection started: ${new Date().toISOString()}`,
  );
  stage = "password_input";
  const password = await readOperatorPassword(process.stdin);
  stage = "certificate_file";
  const ca = await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8");
  const owner = new Pool({
    ...operatorConnection(
      process.env.JCO_MIGRATION_DATABASE_URL ?? "",
      process.env.JCO_SUPABASE_URL ?? "",
      password,
      ca,
    ),
    max: 1,
  });
  owner.on("error", () => {});
  let runtime: Pool | undefined;
  try {
    stage = "owner_authentication_and_scope";
    const db = postgresDatabase(owner);
    const preflight = await ownerPreflight(db);
    if (
      !preflight.connected_as_owner ||
      !preflight.owns_campaign_table ||
      !preflight.synthetic_stage
    )
      throw Error("Owner scope refused.");
    console.info(
      "Owner authentication, verified TLS and synthetic project scope passed.",
    );
    stage = "atomic_role_configuration";
    await configureRuntimeLogging(db, async (snapshot) => {
      const path = `private/runtime-logging-before-${randomUUID()}.json`;
      const file = await open(path, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify(
            { ...snapshot, recordedAt: new Date().toISOString() },
            null,
            2,
          ),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      console.info(`Previous targeted settings recorded privately: ${path}`);
    });
    settingsCommitted = true;
    console.info(
      "Eight logging defaults committed for jco_admin_reader only. Data, passwords, permissions, schedules and other roles unchanged.",
    );
    const cutoff = (await owner.query("SELECT clock_timestamp() AS at")).rows[0]
      .at;
    stage = "recycle_idle_runtime_connections";
    // Explicit owner-confirmed synthetic maintenance. Never terminate active
    // work, other roles, the owner, background workers or the database service.
    const recycled =
      await owner.query(`SELECT pg_terminate_backend(pid) AS stopped
      FROM pg_stat_activity WHERE datname=current_database()
      AND usename='jco_admin_reader' AND backend_type='client backend'
      AND state='idle' AND pid<>pg_backend_pid()`);
    console.info(
      `Idle application connections recycled: ${recycled.rows.filter((row) => row.stopped === true).length}. Active work was not targeted.`,
    );
    const oldConnections = await owner.query(
      `SELECT count(*)::integer AS count
      FROM pg_stat_activity WHERE datname=current_database()
      AND usename='jco_admin_reader' AND backend_type='client backend'
      AND backend_start < $1`,
      [cutoff],
    );
    const remainingOldConnections = oldConnections.rows[0].count;
    stage = "fresh_restricted_verification";
    runtime = new Pool({
      ...postgresOptions(process.env.DATABASE_URL, process.env.JCO_DATABASE_CA),
      max: 1,
    });
    runtime.on("error", () => {});
    const runtimeDb = postgresDatabase(runtime);
    const audit = await inspectUploadLogging(runtimeDb);
    await verifyReader(runtimeDb);
    console.info(
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          ...audit,
          restrictedPrivilegesVerified: true,
          remainingOldConnections,
        },
        null,
        2,
      ),
    );
    if (!audit.loggingBaselinePassed || remainingOldConnections !== 0) {
      console.info(
        "Defaults are saved, but the effective runtime check has not passed. Do not load real data. Share this output for follow-up; do not reset the database.",
      );
      process.exitCode = 2;
      return;
    }
    console.info(
      "Runtime logging protection VERIFIED through the restricted pooler connection. Existing data and permissions preserved. Real-data launch still requires the remaining acceptance gates.",
    );
  } finally {
    await Promise.all([owner.end(), runtime?.end()]);
  }
}
void main().catch((error) => {
  console.error(
    `Runtime logging protection stopped: stage=${stage}; category=${safeConnectionFailure(error)}; settings_committed=${settingsCommitted}.`,
  );
  console.error(
    "No passwords, connection strings or raw database errors are printed. Do not reset the database or rerun initialization.",
  );
  process.exitCode = 1;
});
