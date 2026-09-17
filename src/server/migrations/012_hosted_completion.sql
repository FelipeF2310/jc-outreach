GRANT USAGE,CREATE ON SCHEMA outreach TO jco_field_executor,jco_field_admin_executor;
GRANT SELECT,INSERT ON outreach.completion_reports TO jco_field_executor;
GRANT SELECT ON outreach.completion_reports TO jco_field_admin_executor;
CREATE POLICY completion_field_read ON outreach.completion_reports FOR SELECT TO jco_field_executor USING(true);
CREATE POLICY completion_field_insert ON outreach.completion_reports FOR INSERT TO jco_field_executor WITH CHECK(true);
CREATE POLICY completion_admin_read ON outreach.completion_reports FOR SELECT TO jco_field_admin_executor USING(true);
GRANT EXECUTE ON FUNCTION outreach.record_completion(uuid,uuid,text,jsonb) TO jco_field_executor;
GRANT EXECUTE ON FUNCTION outreach.completion_snapshot(uuid) TO jco_field_admin_executor;

CREATE FUNCTION outreach.submit_completion_report(p_hash text,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb;
BEGIN
 a:=outreach.field_access(p_hash,true);
 RETURN outreach.record_completion((a->>'id')::uuid,(a->>'campaignId')::uuid,p_hash,p);
END $body$;
CREATE FUNCTION outreach.field_completion_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
 PERFORM outreach.field_admin_snapshot(p_assignment);
 RETURN outreach.completion_snapshot(p_assignment);
END $body$;
REVOKE ALL ON FUNCTION outreach.submit_completion_report(text,jsonb),outreach.field_completion_snapshot(uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') LOOP
  EXECUTE format('REVOKE ALL ON outreach.completion_reports FROM %I',r.rolname);
  EXECUTE format('REVOKE ALL ON FUNCTION outreach.record_completion(uuid,uuid,text,jsonb),outreach.completion_snapshot(uuid),outreach.submit_completion_report(text,jsonb),outreach.field_completion_snapshot(uuid) FROM %I',r.rolname);
 END LOOP;
END $acl$;
ALTER FUNCTION outreach.submit_completion_report(text,jsonb) OWNER TO jco_field_executor;
ALTER FUNCTION outreach.field_completion_snapshot(uuid) OWNER TO jco_field_admin_executor;
GRANT EXECUTE ON FUNCTION outreach.submit_completion_report(text,jsonb),outreach.field_completion_snapshot(uuid) TO jco_admin_reader;
REVOKE CREATE ON SCHEMA outreach FROM jco_field_executor,jco_field_admin_executor;
