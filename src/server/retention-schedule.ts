import type { Database } from "./db-contract";

export const RETENTION_JOB = "jco-retention-v1";
export const RETENTION_COMMAND =
  "SELECT outreach.run_retention(); DELETE FROM cron.job_run_details WHERE jobid=(SELECT jobid FROM cron.job WHERE jobname='jco-retention-v1' AND username=current_user) AND end_time<now()-interval '7 days';";

/** Explicit operator action, never reachable from HTTP or app startup.
 * Refuses already-overdue data: review exact targets separately before enabling.
 */
export async function enableRetentionSchedule(db: Database) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(73401829)");
    const setup = await tx.query<{
      stage: string;
      installed: boolean;
      cron: boolean;
    }>(
      "SELECT stage,to_regprocedure('outreach.run_retention()') IS NOT NULL AS installed,to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL AS cron FROM outreach.deployment WHERE singleton",
    );
    if (
      setup.rows[0]?.stage !== "synthetic-preview" ||
      !setup.rows[0].installed
    )
      throw Error("Install the synthetic retention update first.");
    if (!setup.rows[0].cron)
      throw Error("Enable the Supabase Cron module first.");
    const overdue = await tx.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM outreach.campaigns WHERE deletion_at<=clock_timestamp()",
    );
    if (overdue.rows[0]?.n !== 0)
      throw Error(
        "Expired campaigns require a separate target review before scheduling deletion.",
      );
    const existing = await tx.query<{
      jobid: number;
      schedule: string;
      command: string;
      active: boolean;
      database: string;
    }>(
      "SELECT jobid,schedule,command,active,database FROM cron.job WHERE jobname=$1 AND username=current_user",
      [RETENTION_JOB],
    );
    const currentDb = await tx.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (existing.rows.length) {
      const job = existing.rows[0];
      if (
        existing.rows.length !== 1 ||
        job.schedule !== "* * * * *" ||
        job.command !== RETENTION_COMMAND ||
        !job.active ||
        job.database !== currentDb.rows[0]?.name
      )
        throw Error(
          "Existing retention schedule differs. Review it without overwriting.",
        );
      return { configured: true, existing: true };
    }
    await tx.query("SELECT cron.schedule($1,$2,$3)", [
      RETENTION_JOB,
      "* * * * *",
      RETENTION_COMMAND,
    ]);
    return { configured: true, existing: false };
  });
}
