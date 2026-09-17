/** Operator-only disposable fixture. Never imported by the web application. */
import { randomBytes, randomUUID } from "node:crypto";
import type { Database, SqlConnection } from "../../src/server/db-contract";
import type { Assignment, VisitOperation } from "../../src/lib/contracts";
import { DomainError } from "../../src/lib/contracts";
import { hashToken } from "../../src/server/service";
import { rehearsalCsv } from "../../src/server/import-rehearsal";
import { validateImport } from "../../src/server/import-validation";
import {
  RETENTION_COMMAND,
  RETENTION_JOB,
} from "../../src/server/retention-schedule";
import {
  downloadHostedAssignment,
  submitHostedOperation,
} from "../../src/server/hosted-field";

const NAME = "Synthetic: DISPOSABLE retention verification";
export const retentionTables = [
  "campaigns",
  "events",
  "assignments",
  "households",
  "people",
  "memberships",
  "credentials",
  "operations",
  "visits",
  "help_requests",
  "corrections",
  "building_attempts",
  "imports",
  "buildings",
  "import_people",
  "completion_reports",
  "help_status_changes",
  "correction_status_changes",
  "reassignments",
  "import_rehearsals",
] as const;

// Only fixed reviewed identifiers enter SQL. Digests never leave the process.
async function inventory(tx: SqlConnection, ids: string[] = []) {
  const fingerprints: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const table of [...retentionTables, "retention_failures"]) {
    const result = await tx.query<{ fingerprint: string; n: number }>(
      `SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text))
       FILTER (WHERE NOT (to_jsonb(t)::text LIKE ANY($1::text[]))),'')) AS fingerprint,
       count(*) FILTER (WHERE to_jsonb(t)::text LIKE ANY($1::text[]))::int AS n
       FROM outreach.${table} t`,
      [ids.map((id) => `%${id}%`)],
    );
    fingerprints[table] = result.rows[0].fingerprint;
    counts[table] = result.rows[0].n;
  }
  return { fingerprints, counts };
}

function same(a: Record<string, string>, b: Record<string, string>) {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw Error(
      "Unrelated records changed; verification is inconclusive. Do not reset or retry setup.",
    );
}

async function schedule(tx: SqlConnection) {
  const result = await tx.query<{ jobid: string; valid: boolean }>(
    `SELECT jobid::text, (active AND schedule='* * * * *' AND command=$2
       AND database=current_database()) AS valid
     FROM cron.job WHERE jobname=$1 AND username=current_user`,
    [RETENTION_JOB, RETENTION_COMMAND],
  );
  if (result.rows.length !== 1 || !result.rows[0].valid)
    throw Error("The existing retention schedule must match exactly.");
  return result.rows[0].jobid;
}

export async function prepareRetentionRehearsal(owner: Database) {
  return owner.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73401830)");
    const check = await tx.query<{ safe: boolean }>(
      `SELECT stage='synthetic-preview'
       AND pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid='outreach.campaigns'::regclass))=current_user
       AND NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE deletion_at<clock_timestamp()+interval '10 minutes' OR name=$1)
       AND EXISTS(SELECT 1 FROM outreach.retention_health WHERE checked_at>clock_timestamp()-interval '5 minutes') AS safe
       FROM outreach.deployment WHERE singleton`,
      [NAME],
    );
    if (check.rows[0]?.safe !== true)
      throw Error(
        "Requires synthetic owner, healthy worker, no pending rehearsal and no near-expiry campaigns.",
      );
    const jobId = await schedule(tx);
    const baseline = await inventory(tx);
    const deleted = await tx.query<{ n: string }>(
      "SELECT deleted_campaigns::text AS n FROM outreach.retention_health WHERE singleton",
    );
    const dates = await tx.query<{ ending: string; event: string }>(
      "SELECT ((now() AT TIME ZONE 'America/New_York')::date+3)::text AS ending, ((now() AT TIME ZONE 'America/New_York')::date+2)::text AS event",
    );
    // Random actor is explicitly a synthetic operator fixture, not an administrator identity.
    const actor = randomUUID(),
      campaignId = randomUUID(),
      eventId = randomUUID();
    const assignmentId = randomUUID(),
      reassignedId = randomUUID();
    const token = randomBytes(32).toString("base64url"),
      hash = hashToken(token);
    await tx.query(
      "SELECT outreach.create_synthetic_campaign($1,$2,$3::date,$4)",
      [
        campaignId,
        NAME.slice("Synthetic: ".length),
        dates.rows[0].ending,
        actor,
      ],
    );
    const { preview } = validateImport(
      rehearsalCsv("valid-couple-and-buildings"),
    );
    if (!preview.valid || !preview.digest)
      throw Error("Synthetic fixture invalid.");
    await tx.query("SELECT outreach.finalize_synthetic_import($1,$2,$3)", [
      campaignId,
      preview.digest,
      actor,
    ]);
    await tx.query(
      "SELECT outreach.create_outreach_event($1,$2,$3,$4::date,$5)",
      [
        eventId,
        campaignId,
        "Disposable retention event",
        dates.rows[0].event,
        actor,
      ],
    );
    const households = await tx.query<{ id: string }>(
      "SELECT id FROM outreach.households WHERE campaign_id=$1 ORDER BY id",
      [campaignId],
    );
    await tx.query(
      "SELECT outreach.prepare_assignment($1,$2,$3,$4,$5,$6::uuid[],$7)",
      [
        assignmentId,
        campaignId,
        eventId,
        "Disposable retention walk",
        "scattered",
        households.rows.map((h) => h.id),
        actor,
      ],
    );
    await tx.query("SELECT outreach.issue_field_credential($1,$2,$3,$4,$5)", [
      randomUUID(),
      assignmentId,
      hash,
      actor,
      "Disposable test credential — never shared",
    ]);
    const download = await tx.query<{ assignment: Assignment }>(
      "SELECT outreach.download_field_assignment($1) AS assignment",
      [hash],
    );
    const doors = download.rows[0].assignment.households,
      household = doors[0];
    const createdAt = new Date().toISOString();
    const visit: VisitOperation = {
      id: randomUUID(),
      visitId: randomUUID(),
      assignmentId,
      householdId: household.id,
      schemaVersion: 1,
      createdAt,
      kind: "visit",
      result: "resident",
      programs: [],
      doNotContact: true,
      help: {
        id: randomUUID(),
        personId: household.people[0].id,
        phone: "2015550100",
        consent: true,
        arrangement: "return",
      },
      corrections: [
        { id: randomUUID(), kind: "moved", personId: household.people[0].id },
      ],
    };
    const revision = {
      id: randomUUID(),
      assignmentId,
      createdAt,
      schemaVersion: 1,
      kind: "revision",
      visitId: visit.visitId,
      householdId: household.id,
      originalOperationId: visit.id,
      previousOperationId: visit.id,
      result: "other",
    };
    const building = {
      id: randomUUID(),
      assignmentId,
      createdAt,
      schemaVersion: 1,
      kind: "building",
      buildingId: household.buildingId,
      reason: "locked",
    };
    for (const operation of [visit, revision, building])
      await tx.query("SELECT outreach.submit_field_operation($1,$2::jsonb)", [
        hash,
        JSON.stringify(operation),
      ]);
    await tx.query(
      "SELECT outreach.update_help_status($1,$2,$3,0,'In progress',$4)",
      [randomUUID(), campaignId, visit.help!.id, actor],
    );
    await tx.query(
      "SELECT outreach.update_correction_status($1,$2,$3,0,'Reviewed',$4)",
      [randomUUID(), campaignId, visit.corrections[0].id, actor],
    );
    await tx.query("SELECT outreach.submit_completion_report($1,$2::jsonb)", [
      hash,
      JSON.stringify({
        id: randomUUID(),
        assignmentId,
        deviceId: randomUUID(),
        version: 1,
        state: "finished",
        operationIds: [visit.id, revision.id, building.id],
        pendingIds: [],
        createdAt,
      }),
    ]);
    await tx.query(
      "SELECT outreach.reassign_households($1,$2,$3,$4,$5::uuid[],$6)",
      [
        reassignedId,
        campaignId,
        assignmentId,
        "Disposable reassigned door",
        [doors[1].id],
        actor,
      ],
    );
    await tx.query(
      "INSERT INTO outreach.import_rehearsals(campaign_id,end_at,assignment_id) SELECT id,end_at,$2 FROM outreach.campaigns WHERE id=$1",
      [campaignId, assignmentId],
    );

    // Accelerated fixture clock only: this uncommitted, newly generated campaign
    // is aged to 30 local calendar days before its deadline. Existing IDs cannot
    // be supplied by callers. Nothing changes the production retention formula.
    const deadline = await tx.query<{ deletion_at: Date }>(
      `WITH deadline AS (SELECT clock_timestamp()+interval '2 minutes' AS at)
       UPDATE outreach.campaigns c SET deletion_at=d.at,
         end_at=((d.at AT TIME ZONE 'America/New_York')-interval '30 days') AT TIME ZONE 'America/New_York'
       FROM deadline d WHERE c.id=$1 AND c.name=$2 AND c.created_by=$3 RETURNING c.deletion_at`,
      [campaignId, NAME, actor],
    );
    if (deadline.rows.length !== 1) throw Error("Disposable target mismatch.");
    await tx.query(
      "UPDATE outreach.events e SET ends_at=c.end_at FROM outreach.campaigns c WHERE e.campaign_id=c.id AND c.id=$1",
      [campaignId],
    );
    await tx.query(
      "UPDATE outreach.assignments a SET event_ends_at=c.end_at FROM outreach.campaigns c WHERE a.campaign_id=c.id AND c.id=$1",
      [campaignId],
    );
    await tx.query(
      "UPDATE outreach.import_rehearsals r SET end_at=c.end_at FROM outreach.campaigns c WHERE r.campaign_id=c.id AND c.id=$1",
      [campaignId],
    );
    const ids = [
      campaignId,
      eventId,
      assignmentId,
      reassignedId,
      visit.id,
      visit.visitId,
      revision.id,
      building.id,
      ...doors.flatMap((h) => [
        h.id,
        h.buildingId,
        ...h.people.map((p) => p.id),
      ]),
    ];
    const seeded = await inventory(tx, ids);
    same(baseline.fingerprints, seeded.fingerprints);
    if (retentionTables.some((table) => seeded.counts[table] < 1))
      throw Error("Fixture coverage incomplete.");
    return {
      campaignId,
      deletionAt: deadline.rows[0].deletion_at.toISOString(),
      jobId,
      token,
      visit,
      ids,
      fingerprints: baseline.fingerprints,
      deletedBefore: deleted.rows[0].n,
    };
  });
}

export type RetentionRehearsal = Awaited<
  ReturnType<typeof prepareRetentionRehearsal>
>;

/** Read-only observation. Does not call, reschedule or imitate the worker. */
export async function inspectRetentionRehearsal(
  owner: Database,
  fixture: RetentionRehearsal,
) {
  return owner.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if ((await schedule(tx)) !== fixture.jobId)
      throw Error("Schedule changed during verification.");
    const rows = await inventory(tx, fixture.ids);
    same(fixture.fingerprints, rows.fingerprints);
    const remaining = Object.values(rows.counts).reduce((a, b) => a + b, 0);
    if (remaining) return { complete: false as const, remaining };
    const health = await tx.query<{ n: string; recent: boolean }>(
      "SELECT deleted_campaigns::text AS n,checked_at>=$1::timestamptz AS recent FROM outreach.retention_health WHERE singleton",
      [fixture.deletionAt],
    );
    const runs = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cron.job_run_details WHERE jobid=$1::bigint AND status='succeeded' AND start_time>=$2::timestamptz AND end_time IS NOT NULL",
      [fixture.jobId, fixture.deletionAt],
    );
    if (
      !health.rows[0]?.recent ||
      BigInt(health.rows[0].n) !== BigInt(fixture.deletedBefore) + 1n ||
      runs.rows[0].n < 1
    )
      return { complete: false as const, remaining: 0 };
    return {
      complete: true as const,
      remaining: 0,
      tablesChecked: retentionTables.length,
      scheduledRunConfirmed: true,
    };
  });
}

/** A regression that accepts an old upload is forcibly rolled back, never committed. */
export async function verifyDeletedCredential(
  runtime: Database,
  fixture: RetentionRehearsal,
) {
  for (const probe of [
    downloadHostedAssignment,
    (db: Database, token: string) =>
      submitHostedOperation(db, token, fixture.visit),
  ]) {
    try {
      await runtime.transaction(async (tx) => {
        await probe(
          { ...tx, transaction: async (work) => work(tx) },
          fixture.token,
        );
        throw Error(
          "Deleted credential unexpectedly accepted; probe rolled back.",
        );
      });
    } catch (error) {
      if (error instanceof DomainError && error.status === 401) continue;
      throw error;
    }
  }
}
