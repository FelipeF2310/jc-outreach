import type { Database } from "./db-contract";
import { listHostedCampaigns } from "./hosted-campaigns";

/** Read-only checks of table access and the explicitly reviewed synthetic functions. */
export async function verifyReader(db: Database) {
  const { rows } = await db.query<{ allowed: boolean }>(`
    SELECT (
      current_user = 'jco_admin_reader'
      AND r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolsuper
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole
      AND NOT r.rolreplication AND NOT r.rolbypassrls
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
      AND has_schema_privilege(current_user, 'outreach', 'USAGE')
      AND NOT has_schema_privilege(current_user, 'outreach', 'CREATE')
      AND to_regclass('outreach.people') IS NOT NULL
      AND to_regclass('outreach.credentials') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'outreach' AND c.relkind IN ('r','p','v','m','f')
        AND (
          c.relowner = r.oid OR NOT c.relrowsecurity
          OR has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES')
          OR (c.relname IN ('campaigns','deployment') AND
            (NOT has_table_privilege(current_user, c.oid, 'SELECT') OR NOT row_security_active(c.oid)))
          OR (c.relname NOT IN ('campaigns','deployment') AND
            has_any_column_privilege(current_user, c.oid, 'SELECT'))
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'outreach' AND c.relkind = 'S'
          AND has_sequence_privilege(current_user, c.oid, 'USAGE,SELECT,UPDATE')
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_roles owner_role ON owner_role.oid = p.proowner
        WHERE n.nspname = 'outreach' AND has_function_privilege(current_user,p.oid,'EXECUTE')
        AND (NOT coalesce((
            (p.oid = to_regprocedure('outreach.create_synthetic_campaign(uuid,text,date,uuid)') AND owner_role.rolname = 'jco_campaign_executor')
            OR (p.oid IN (to_regprocedure('outreach.finalize_synthetic_import(uuid,text,uuid)'), to_regprocedure('outreach.synthetic_import_status()')) AND owner_role.rolname = 'jco_import_executor')
            OR (p.oid IN (to_regprocedure('outreach.assignment_workspace(uuid)'), to_regprocedure('outreach.create_outreach_event(uuid,uuid,text,date,uuid)'), to_regprocedure('outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid)')) AND owner_role.rolname = 'jco_assignment_executor')
            OR (p.oid IN (to_regprocedure('outreach.download_field_assignment(text)'), to_regprocedure('outreach.submit_field_operation(text,jsonb)')) AND owner_role.rolname='jco_field_executor')
            OR (p.oid IN (to_regprocedure('outreach.field_admin_snapshot(uuid)'), to_regprocedure('outreach.issue_field_credential(uuid,uuid,text,uuid)'), to_regprocedure('outreach.issue_field_credential(uuid,uuid,text,uuid,text)'), to_regprocedure('outreach.revoke_field_credential(uuid,uuid,uuid)')) AND owner_role.rolname='jco_field_admin_executor')
            OR (p.oid IN (to_regprocedure('outreach.help_queue(uuid)'), to_regprocedure('outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid)')) AND owner_role.rolname='jco_help_executor')
            OR (p.oid IN (to_regprocedure('outreach.correction_queue(uuid)'), to_regprocedure('outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid)')) AND owner_role.rolname='jco_correction_executor')
          ), false)
          OR NOT p.prosecdef
          OR owner_role.rolcanlogin OR owner_role.rolsuper OR owner_role.rolbypassrls
          OR NOT coalesce(p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp'], false))
      )
    ) AS allowed FROM pg_roles r WHERE r.rolname = current_user
  `);
  if (rows[0]?.allowed !== true)
    throw new Error(
      "Reader privileges do not match the reviewed configuration.",
    );
  // Also confirms the synthetic stage marker and the actual runtime read path.
  const campaigns = await listHostedCampaigns(db);
  return { campaignCount: campaigns.length };
}
