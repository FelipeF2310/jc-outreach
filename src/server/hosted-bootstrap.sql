-- Run only through prepareHosted on an EMPTY synthetic-preview database.
-- The runtime is deliberately read-only for this foundation milestone.
CREATE TABLE outreach.deployment (
  singleton boolean PRIMARY KEY CHECK(singleton),
  stage text NOT NULL CHECK(stage = 'synthetic-preview')
);
INSERT INTO outreach.deployment VALUES (true, 'synthetic-preview');

-- Fail if the role already exists: do not silently adopt pre-existing privileges.
CREATE ROLE jco_admin_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
REVOKE ALL ON ALL TABLES IN SCHEMA outreach FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA outreach FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA outreach REVOKE ALL ON TABLES FROM PUBLIC;
GRANT USAGE ON SCHEMA outreach TO jco_admin_reader;
GRANT SELECT ON outreach.campaigns, outreach.deployment TO jco_admin_reader;

DO $body$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'outreach' LOOP
    EXECUTE format('ALTER TABLE outreach.%I ENABLE ROW LEVEL SECURITY', item.tablename);
  END LOOP;
  -- Supabase's client-facing roles must not inherit access through project defaults.
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA outreach FROM %I', item.rolname);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA outreach FROM %I', item.rolname);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA outreach FROM %I', item.rolname);
  END LOOP;
END $body$;
CREATE POLICY reader_stage ON outreach.deployment FOR SELECT TO jco_admin_reader USING (true);
CREATE POLICY reader_active_campaigns ON outreach.campaigns FOR SELECT TO jco_admin_reader USING (deletion_at > now());
