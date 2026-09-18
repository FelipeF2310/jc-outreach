/** Explicit local operator workflow; not imported by the web application.
 * Original/raw CSVs never pass through Vercel. Runtime role alone imports the
 * minimized rows, attributed to a freshly provider-verified administrator.
 */
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { adminConfig } from "../src/server/admin-config";
import { requireAdministrator } from "../src/server/admin-auth";
import { operatorConnection } from "../src/server/operator-connection";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { safeConnectionFailure } from "../src/server/owner-preflight";
import { migrateLive } from "../src/server/migrate-live";
import { verifyReader } from "../src/server/verify-reader";
import { inspectUploadLogging } from "../src/server/upload-safety";
import {
  preloadLiveCampaign,
  preloadPlanSchema,
} from "../src/server/live-preload";
import {
  RETENTION_JOB,
  RETENTION_COMMAND,
} from "../src/server/retention-schedule";
import { listHostedCampaigns } from "../src/server/hosted-campaigns";
import { CSV_BODY_BYTES } from "../src/server/csv-intake";
import { DomainError } from "../src/lib/contracts";

const requestSchema = z.strictObject({
  origin: z.url(),
  projectUrl: z.url(),
  candidatePath: z.string().min(1),
  candidateSha256: z.string().regex(/^[a-f0-9]{64}$/),
  plan: preloadPlanSchema,
});
let stage = "configuration";
let activated = false;
let campaignCommitted = false;
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--operator-stdin")
    throw Error("Explicit local operator action required");
  const request = requestSchema.parse(
    JSON.parse(await readFile(process.argv[3], "utf8")),
  );
  const config = adminConfig();
  if (
    request.projectUrl !== config.supabaseUrl ||
    request.origin !== "https://jc-outreach-test.vercel.app"
  )
    throw Error("Unexpected project target");
  console.info(`Ward A live setup started: ${new Date().toISOString()}`);
  stage = "deployed_application_check";
  const deployed = await fetch(`${request.origin}/api/app-version`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!deployed.ok || deployed.headers.get("X-JCO-Live-Campaigns") !== "1")
    throw Error("Compatible hosted release required before activation");
  stage = "private_password_input";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > 16384) throw Error("Operator input too large");
    chunks.push(chunk);
  }
  const credentials = Buffer.concat(chunks).toString("utf8").split("\0");
  chunks.forEach((chunk) => chunk.fill(0));
  if (credentials.length !== 3) throw Error("Three private fields required");
  const [ownerPassword, email, administratorPassword] = credentials;
  if (
    !config.emails.includes(email.trim().toLowerCase()) ||
    !administratorPassword
  )
    throw Error("Approved administrator required");
  const client = createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  let owner: Pool | undefined;
  let runtime: Pool | undefined;
  try {
    stage = "administrator_authentication";
    const auth = await client.auth.signInWithPassword({
      email: email.trim(),
      password: administratorPassword,
    });
    if (auth.error) throw new DomainError(401, "Administrator sign-in failed");
    const administrator = await requireAdministrator(client, config);
    console.info(
      "Approved administrator verified by the authentication provider.",
    );
    stage = "approved_source_check";
    const metadata = await stat(request.candidatePath);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > CSV_BODY_BYTES
    )
      throw Error("Approved candidate unavailable or oversized");
    const bytes = await readFile(request.candidatePath);
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      request.candidateSha256
    )
      throw Error("Approved file bytes changed");
    const ca = await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8");
    owner = new Pool({
      ...operatorConnection(
        process.env.JCO_MIGRATION_DATABASE_URL ?? "",
        config.supabaseUrl,
        ownerPassword,
        ca,
      ),
      max: 1,
    });
    owner.on("error", () => {});
    stage = "owner_scope_and_verified_tls";
    const scope =
      await owner.query(`SELECT current_user='postgres' AND current_user=session_user
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS allowed
      FROM pg_class c WHERE c.oid='outreach.campaigns'::regclass`);
    if (scope.rows[0]?.allowed !== true) throw Error("Owner scope rejected");
    stage = "additive_live_migration";
    await migrateLive(postgresDatabase(owner));
    console.info(
      "Live capability installed. Existing campaigns, records, passwords and deadlines preserved.",
    );
    runtime = new Pool({
      ...postgresOptions(
        process.env.DATABASE_URL ?? "",
        process.env.JCO_DATABASE_CA,
      ),
      max: 1,
    });
    runtime.on("error", () => {});
    const db = postgresDatabase(runtime);
    stage = "restricted_runtime_and_logging";
    await verifyReader(db);
    if (!(await inspectUploadLogging(db)).loggingBaselinePassed)
      throw Error("Runtime logging verification failed");
    stage = "scheduled_retention_check";
    const scheduled = await owner.query(
      `SELECT j.active AND j.schedule='* * * * *'
      AND j.command=$2 AND j.database=current_database()
      AND EXISTS(SELECT 1 FROM cron.job_run_details d WHERE d.jobid=j.jobid
        AND d.status='succeeded' AND d.end_time>now()-interval '5 minutes')
      AND EXISTS(SELECT 1 FROM outreach.retention_health WHERE singleton AND checked_at>now()-interval '5 minutes')
      AND NOT EXISTS(SELECT 1 FROM outreach.retention_failures)
      AND NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE deletion_at<=now()) AS healthy
      FROM cron.job j WHERE j.jobname=$1 AND j.username=current_user`,
      [RETENTION_JOB, RETENTION_COMMAND],
    );
    if (scheduled.rows.length !== 1 || scheduled.rows[0].healthy !== true)
      throw Error("Recent successful scheduled retention required");
    stage = "explicit_live_activation";
    await postgresDatabase(owner).transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73401842)");
      const result = await tx.query(
        "UPDATE outreach.deployment SET stage='outreach-live' WHERE singleton AND stage IN ('synthetic-preview','outreach-live') RETURNING stage",
      );
      if (result.rows.length !== 1) throw Error("Activation failed");
    });
    activated = true;
    // Owner connection is closed BEFORE any resident rows are submitted.
    await owner.end();
    owner = undefined;
    stage = "atomic_campaign_import_and_ten_assignments";
    const result = await preloadLiveCampaign(
      db,
      request.plan,
      bytes,
      administrator.id,
    );
    campaignCommitted = true;
    stage = "persisted_campaign_verification";
    const saved = (await listHostedCampaigns(db)).find(
      (campaign) => campaign.id === result.campaign.id,
    );
    if (
      saved?.dataKind !== "live" ||
      saved.importReceipt?.importId !== result.receipt.importId
    )
      throw Error("Saved campaign verification failed");
    console.info(
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          campaign: saved.name,
          endAt: saved.endAt,
          deletionAt: saved.deletionAt,
          ...result.receipt.counts,
          assignments: result.pairs.map(({ label, households }) => ({
            label,
            households,
          })),
          volunteerNamesEntered: false,
          credentialsIssued: 0,
          rawFileUploadedToVercel: false,
          existingCampaignsPreserved: true,
        },
        null,
        2,
      ),
    );
    console.info(
      "Ward A campaign and all ten paired assignments saved and verified. Refresh the administrator page and select Ward A Benefits Outreach.",
    );
  } finally {
    await Promise.all([
      owner?.end(),
      runtime?.end(),
      client.auth.signOut({ scope: "local" }).catch(() => {}),
    ]);
  }
}
void main().catch((error: unknown) => {
  console.error(
    `Live setup stopped: stage=${stage}; category=${safeConnectionFailure(error)}; live_mode_active=${activated}; campaign_commit_confirmed=${campaignCommitted}.`,
  );
  console.error(
    "No passwords, residents, connection strings or raw database errors are printed. Do not reset data. Keep the same private plan for a safe retry and share only this status.",
  );
  process.exitCode = 1;
});
