import type { Database } from "./db-contract";

/** Read-only metadata, never replay DDL to diagnose a connection failure. */
export async function ownerPreflight(db: Database) {
  return db.transaction(async (tx) => {
    await tx.exec("SET TRANSACTION READ ONLY");
    const { rows } = await tx.query<{
      connected_as_owner: boolean;
      can_create_roles: boolean;
      owns_campaign_table: boolean;
      schema_create_allowed: boolean;
      synthetic_stage: boolean;
      campaign_update_recorded: boolean;
      server_version_number: number;
    }>(`SELECT
      current_user = 'postgres' AS connected_as_owner,
      r.rolcreaterole AS can_create_roles,
      c.relowner = r.oid AS owns_campaign_table,
      has_schema_privilege(current_user,'outreach','CREATE') AS schema_create_allowed,
      EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') AS synthetic_stage,
      EXISTS(SELECT 1 FROM outreach.schema_migrations WHERE name='003_campaign_creation.sql') AS campaign_update_recorded,
      current_setting('server_version_num')::integer AS server_version_number
      FROM pg_roles r JOIN pg_class c ON c.oid = 'outreach.campaigns'::regclass
      WHERE r.rolname = current_user`);
    if (!rows[0]) throw new Error("Owner metadata unavailable.");
    return rows[0];
  });
}

/** Fixed labels only. Never return messages, details, queries, stacks or arbitrary codes. */
export function safeConnectionFailure(error: unknown) {
  const item = error && typeof error === "object" ? error : {};
  const code = "code" in item ? item.code : undefined;
  const categories: Record<string, string> = {
    "28P01": "password_rejected",
    "28000": "authentication_rejected",
    "42501": "permission_denied",
    "42P01": "required_table_missing",
    "42703": "required_column_missing",
    "53300": "connection_limit",
    "57P01": "server_connection_terminated",
    "57014": "query_cancelled_or_timed_out",
    ENOTFOUND: "host_lookup_failed",
    EAI_AGAIN: "host_lookup_temporary_failure",
    ECONNREFUSED: "connection_refused",
    ECONNRESET: "connection_reset",
    ETIMEDOUT: "connection_timed_out",
    CERT_HAS_EXPIRED: "tls_certificate_expired",
    SELF_SIGNED_CERT_IN_CHAIN: "tls_certificate_untrusted",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "tls_certificate_untrusted",
    ERR_TLS_CERT_ALTNAME_INVALID: "tls_hostname_mismatch",
  };
  if (typeof code === "string" && Object.hasOwn(categories, code))
    return categories[code];
  const message =
    "message" in item && typeof item.message === "string" ? item.message : "";
  if (/password authentication failed/i.test(message))
    return "password_rejected";
  if (/timeout|timed out/i.test(message))
    return "connection_or_query_timed_out";
  if (/connection terminated|socket hang up/i.test(message))
    return "connection_terminated";
  return "unclassified_failure";
}
