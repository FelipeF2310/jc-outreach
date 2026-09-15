-- Hosted-only additive migration. Never edit after application.
ALTER TABLE outreach.campaigns ADD COLUMN end_at timestamptz;
ALTER TABLE outreach.campaigns ADD COLUMN created_by uuid;
ALTER TABLE outreach.campaigns ADD CONSTRAINT campaign_retention_dates CHECK (
  (end_at IS NULL AND created_by IS NULL) OR
  (end_at IS NOT NULL AND created_by IS NOT NULL AND
   deletion_at = ((end_at AT TIME ZONE 'America/New_York') + interval '30 days') AT TIME ZONE 'America/New_York')
);

-- No login/password, no resident privileges, no membership for the runtime.
CREATE ROLE jco_campaign_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Avoid special role specifications in GRANT on managed Supabase Postgres:
-- https://github.com/supabase/postgres/issues/2348
-- Quote the actual operator identifier; never grant membership to the runtime.
DO $membership$
BEGIN
  EXECUTE format('GRANT jco_campaign_executor TO %I', current_user);
END
$membership$;
GRANT USAGE, CREATE ON SCHEMA outreach TO jco_campaign_executor;
GRANT SELECT ON outreach.deployment, outreach.campaigns TO jco_campaign_executor;
GRANT INSERT (id,name,deletion_at,end_at,created_by) ON outreach.campaigns TO jco_campaign_executor;
CREATE POLICY campaign_executor_stage ON outreach.deployment FOR SELECT TO jco_campaign_executor USING (true);
CREATE POLICY campaign_executor_read ON outreach.campaigns FOR SELECT TO jco_campaign_executor USING (deletion_at > now());
CREATE POLICY campaign_executor_insert ON outreach.campaigns FOR INSERT TO jco_campaign_executor
  WITH CHECK (end_at > now() AND created_by IS NOT NULL AND name LIKE 'Synthetic: %');

CREATE FUNCTION outreach.create_synthetic_campaign(p_id uuid, p_name text, p_end date, p_actor uuid)
RETURNS TABLE(id uuid, name text, end_at timestamptz, deletion_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  saved outreach.campaigns%ROWTYPE;
  ends timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM outreach.deployment d WHERE d.singleton AND d.stage = 'synthetic-preview') THEN
    RAISE EXCEPTION USING ERRCODE = 'JC004', MESSAGE = 'Synthetic deployment required';
  END IF;
  IF p_id IS NULL OR p_actor IS NULL OR p_end IS NULL OR p_name IS NULL
    OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]'
    OR p_end < date '2000-01-01' OR p_end > date '9998-12-31' THEN
    RAISE EXCEPTION USING ERRCODE = 'JC001', MESSAGE = 'Invalid campaign fields';
  END IF;
  ends := (p_end + time '23:59:59') AT TIME ZONE 'America/New_York';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text, 73401830));
  SELECT c.* INTO saved FROM outreach.campaigns c WHERE c.id = p_id;
  IF FOUND THEN
    IF saved.name IS DISTINCT FROM ('Synthetic: ' || btrim(p_name))
      OR saved.end_at IS DISTINCT FROM ends OR saved.created_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION USING ERRCODE = 'JC002', MESSAGE = 'Campaign request conflicts with saved record';
    END IF;
  ELSE
    IF ends <= now() THEN
      RAISE EXCEPTION USING ERRCODE = 'JC001', MESSAGE = 'Campaign end must be in the future';
    END IF;
    INSERT INTO outreach.campaigns AS c (id,name,end_at,deletion_at,created_by)
      VALUES (p_id, 'Synthetic: ' || btrim(p_name), ends,
        ((ends AT TIME ZONE 'America/New_York') + interval '30 days') AT TIME ZONE 'America/New_York', p_actor)
      ON CONFLICT DO NOTHING RETURNING c.* INTO saved;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'JC002', MESSAGE = 'Campaign identifier unavailable';
    END IF;
  END IF;
  RETURN QUERY SELECT saved.id, saved.name, saved.end_at, saved.deletion_at;
END
$body$;
REVOKE ALL ON FUNCTION outreach.create_synthetic_campaign(uuid,text,date,uuid) FROM PUBLIC;
-- Remove possible provider default ACLs as well as PUBLIC execution.
DO $acl$
DECLARE item record;
BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.create_synthetic_campaign(uuid,text,date,uuid) FROM %I', item.rolname);
  END LOOP;
END
$acl$;
ALTER FUNCTION outreach.create_synthetic_campaign(uuid,text,date,uuid) OWNER TO jco_campaign_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_campaign_executor;
GRANT EXECUTE ON FUNCTION outreach.create_synthetic_campaign(uuid,text,date,uuid) TO jco_admin_reader;
-- The migration operator retains role administration for future additive updates.
-- The runtime jco_admin_reader is never made a member of this role.
