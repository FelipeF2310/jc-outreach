import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import {
  operatorConnection,
  readOperatorPassword,
} from "../src/server/operator-connection";
import { postgresDatabase, postgresOptions } from "../src/server/postgres";
import { safeConnectionFailure } from "../src/server/owner-preflight";
import { verifyReader } from "../src/server/verify-reader";
import { readRetentionStatus } from "../src/server/admin-retention";
import {
  prepareRetentionRehearsal,
  inspectRetentionRehearsal,
  verifyDeletedCredential,
} from "./lib/retention-rehearsal";

let stage = "configuration";
async function main() {
  if (
    process.argv.length !== 3 ||
    process.argv[2] !== "--password-stdin" ||
    process.env.JCO_HOSTED_STAGE !== "synthetic-preview"
  )
    throw Error("Explicit synthetic operator action required.");
  console.info(
    `Disposable retention rehearsal started: ${new Date().toISOString()}`,
  );
  stage = "password_input";
  const password = await readOperatorPassword(process.stdin);
  stage = "connection_configuration";
  const ca = await readFile(process.env.JCO_MIGRATION_CA_FILE ?? "", "utf8");
  const ownerPool = new Pool(
    operatorConnection(
      process.env.JCO_MIGRATION_DATABASE_URL ?? "",
      process.env.JCO_SUPABASE_URL ?? "",
      password,
      ca,
    ),
  );
  const readerPool = new Pool(
    postgresOptions(
      process.env.DATABASE_URL ?? "",
      process.env.JCO_DATABASE_CA,
    ),
  );
  ownerPool.on("error", () => {});
  readerPool.on("error", () => {});
  try {
    const owner = postgresDatabase(ownerPool),
      runtime = postgresDatabase(readerPool);
    stage = "restricted_runtime_preflight";
    await verifyReader(runtime);
    stage = "owner_authentication_and_fixture_transaction";
    const fixture = await prepareRetentionRehearsal(owner);
    console.info(`Disposable campaign created: ${fixture.campaignId}`);
    console.info(`Scheduled deletion deadline: ${fixture.deletionAt}`);
    stage = "restricted_fixture_visibility";
    const visibility = await readRetentionStatus(runtime, {
      campaignId: fixture.campaignId,
    });
    if (
      !visibility.ready ||
      visibility.selected?.campaignId !== fixture.campaignId ||
      visibility.selected.openHelpRequests !== 1
    )
      throw Error(
        "Restricted runtime did not confirm this exact disposable fixture.",
      );
    console.info(
      "20 campaign/child tables populated with synthetic data, including an open help request. Existing records unchanged.",
    );
    console.info(
      "Waiting for the existing automatic schedule. No manual deletion or worker invocation will run. Please leave this Terminal open and avoid practice edits during the check.",
    );
    stage = "scheduled_deletion_observation";
    // Bounded waits with progress; the credential stays in memory, never printed or saved.
    for (let attempt = 0; attempt < 24; attempt++) {
      await setTimeout(15000);
      const observed = await inspectRetentionRehearsal(owner, fixture);
      if (!observed.complete) {
        console.info(
          `Waiting for scheduled cleanup and receipt (${attempt + 1}/24).`,
        );
        continue;
      }
      stage = "old_credential_rejection";
      await verifyDeletedCredential(runtime, fixture);
      stage = "final_preservation_check";
      if (!(await inspectRetentionRehearsal(owner, fixture)).complete)
        throw Error("Final verification incomplete.");
      console.info(
        "Scheduled deletion VERIFIED: disposable campaign and all 20 populated table groups removed; open help request removed; successful Cron run confirmed; old credential download/upload rejected; other campaign records and deadlines unchanged.",
      );
      console.info(
        "Only disposable synthetic data was permanently removed from live tables. Backups and offline devices are separate, unverified retention boundaries.",
      );
      return;
    }
    throw Error("Scheduled cleanup not confirmed within six minutes.");
  } finally {
    await Promise.all([ownerPool.end(), readerPool.end()]);
  }
}
main().catch((error: unknown) => {
  console.error(
    `Retention rehearsal not verified: stage=${stage}; category=${safeConnectionFailure(error)}.`,
  );
  console.error(
    "A disposable fixture may remain or may already have been removed by the scheduler. Do not rerun, reset, delete practice data or change deadlines. Share this sanitized output and any disposable campaign ID above for a read-only check.",
  );
  process.exitCode = 1;
});
