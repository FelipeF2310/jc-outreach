import type { Database } from "./db-contract";

/** Fixed operator-only policy; never accept SQL, a role name or values from HTTP. */
export const runtimeLoggingPolicy = [
  ["log_statement", "none"],
  ["log_min_duration_statement", "-1"],
  ["log_parameter_max_length", "0"],
  ["log_parameter_max_length_on_error", "0"],
  ["auto_explain.log_min_duration", "-1"],
  ["auto_explain.log_parameter_max_length", "0"],
  // Supabase does not expose log_error_verbosity. Prevent routine error text
  // at its source instead. This does NOT alter client error delivery, other
  // roles, cluster-wide logging, or application HTTP error/status responses.
  ["log_min_messages", "panic"],
  ["log_min_error_statement", "panic"],
] as const;

export interface LoggingSnapshot {
  version: 1;
  role: "jco_admin_reader";
  settings: string[];
}

export async function configureRuntimeLogging(
  db: Database,
  saveSnapshot: (snapshot: LoggingSnapshot) => Promise<void>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL lock_timeout='5s'");
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('jco-runtime-logging-v1',0))",
    );
    const { rows } = await tx.query<{ allowed: boolean }>(`SELECT (
      current_user=session_user
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND current_user<>'jco_admin_reader'
      AND EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview')
      AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls
      AND NOT r.rolcreaterole AND NOT r.rolcreatedb AND NOT r.rolreplication AND NOT r.rolinherit
      AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      AND NOT EXISTS(SELECT 1 FROM pg_db_role_setting s, unnest(s.setconfig) AS cfg(value)
        WHERE s.setrole=r.oid AND s.setdatabase<>0 AND
          (left(cfg.value,4)='log_' OR cfg.value LIKE 'auto_explain.%' OR cfg.value LIKE 'pgaudit.%'))
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
        unnest(p.proconfig) AS cfg(value) WHERE n.nspname='outreach' AND
          (left(cfg.value,4)='log_' OR cfg.value LIKE 'auto_explain.%' OR cfg.value LIKE 'pgaudit.%'))
    ) AS allowed FROM pg_roles r JOIN pg_class c ON c.oid='outreach.campaigns'::regclass
    WHERE r.rolname='jco_admin_reader'`);
    if (rows[0]?.allowed !== true)
      throw Error("Logging update scope check failed.");
    const previous = await tx.query<{ config: string[] }>(
      `SELECT ARRAY(
      SELECT cfg FROM pg_db_role_setting s, unnest(s.setconfig) cfg
      WHERE s.setrole=(SELECT oid FROM pg_roles WHERE rolname='jco_admin_reader')
        AND s.setdatabase=0 AND split_part(cfg,'=',1)=ANY($1::text[])
      ORDER BY cfg
    ) AS config`,
      [runtimeLoggingPolicy.map(([name]) => name)],
    );
    if (!Array.isArray(previous.rows[0]?.config))
      throw Error("Logging snapshot unavailable.");
    await saveSnapshot({
      version: 1,
      role: "jco_admin_reader",
      settings: previous.rows[0].config,
    });
    for (const [name, value] of runtimeLoggingPolicy)
      await tx.exec(`ALTER ROLE jco_admin_reader SET "${name}" TO '${value}'`);
    return {
      settingsUpdated: runtimeLoggingPolicy.length,
      freshConnectionVerificationRequired: true,
    };
  });
}
