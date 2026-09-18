import type { Database } from "./db-contract";

export const uploadLoggingSettings = [
  "log_statement",
  "log_min_duration_statement",
  "log_min_duration_sample",
  "log_parameter_max_length",
  "log_parameter_max_length_on_error",
  "log_error_verbosity",
  "log_min_messages",
  "log_min_error_statement",
  "log_transaction_sample_rate",
  "pgaudit.log",
  "pgaudit.log_parameter",
  "auto_explain.log_min_duration",
  "auto_explain.log_parameter_max_length",
] as const;
type Setting = (typeof uploadLoggingSettings)[number];
type Check = { setting: Setting; status: "pass" | "review" | "unknown" };

/** Conservative pre-import baseline, not proof of provider-wide non-retention.
 * Never return setting values or a raw database exception to an operator log.
 * Missing extension settings are unknown, not automatically a privacy pass.
 */
export function assessUploadLogging(
  rows: { name: string; setting: string | null }[],
) {
  const exactly = (name: string, value: string) => {
    const matches = rows.filter((row) => row.name === name);
    return matches.length === 1 && matches[0].setting === value;
  };
  const routineErrorTextSuppressed =
    exactly("log_min_messages", "panic") &&
    exactly("log_min_error_statement", "panic");
  const expected: Record<Setting, readonly string[]> = {
    log_statement: ["none", "ddl"],
    log_min_duration_statement: ["-1"],
    log_min_duration_sample: ["-1"],
    log_parameter_max_length: ["0"],
    log_parameter_max_length_on_error: ["0"],
    // Terse alone can still expose primary error text (e.g. invalid input).
    // Suppression is tested against actual PostgreSQL server logs, not assumed.
    log_error_verbosity: routineErrorTextSuppressed
      ? ["terse", "default", "verbose"]
      : [],
    log_min_messages: ["panic"],
    log_min_error_statement: ["panic"],
    log_transaction_sample_rate: ["0"],
    "pgaudit.log": ["none"],
    "pgaudit.log_parameter": ["off"],
    "auto_explain.log_min_duration": ["-1"],
    "auto_explain.log_parameter_max_length": ["0"],
  };
  const checks: Check[] = uploadLoggingSettings.map((name) => {
    const matches = rows.filter((row) => row.name === name);
    const value = matches.length === 1 ? matches[0].setting : null;
    return {
      setting: name,
      status:
        value === null
          ? "unknown"
          : expected[name].includes(value)
            ? "pass"
            : "review",
    };
  });
  return {
    checks,
    loggingBaselinePassed: checks.every((check) => check.status === "pass"),
    routineErrorTextSuppressed,
    // A green database check never opens ingress or approves real resident use.
    realDataApproved: false as const,
  };
}

/** Operator-only read-only inventory via the existing restricted connection.
 * No imports, row reads, deliberate error/slow-query probes, or settings writes.
 */
export async function inspectUploadLogging(db: Database) {
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION READ ONLY");
    const scope = await tx.query<{
      restricted: boolean;
      reviewed: boolean;
      read_only: boolean;
    }>(
      `SELECT current_user='jco_admin_reader' AS restricted,
        stage IN ('synthetic-preview','outreach-live') AS reviewed,
        current_setting('transaction_read_only')='on' AS read_only
       FROM outreach.deployment WHERE singleton`,
    );
    const verified = scope.rows[0];
    if (!verified?.restricted || !verified.reviewed || !verified.read_only)
      throw new Error(
        "Upload audit requires the restricted reviewed read-only connection.",
      );
    const settings = await tx.query<{ name: string; setting: string | null }>(
      "SELECT name,setting FROM pg_settings WHERE name=ANY($1::text[]) ORDER BY name",
      [[...uploadLoggingSettings]],
    );
    // Function-local overrides could defeat a caller-session baseline.
    const overrides = await tx.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace
       CROSS JOIN LATERAL unnest(p.proconfig) AS config(setting)
       WHERE n.nspname='outreach' AND
         (left(config.setting,4)='log_'
          OR config.setting LIKE 'pgaudit.%' OR config.setting LIKE 'auto_explain.%')`,
    );
    const assessment = assessUploadLogging(settings.rows);
    const noOverrides = overrides.rows[0]?.count === 0;
    return {
      ...assessment,
      functionLoggingOverrides: noOverrides ? "none" : "review_required",
      loggingBaselinePassed: assessment.loggingBaselinePassed && noOverrides,
    };
  });
}
