-- Administrator correction review metadata only; never modifies source people/households or field reports.
ALTER TABLE outreach.corrections ADD COLUMN status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Reviewed'));
ALTER TABLE outreach.corrections ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE outreach.corrections ADD COLUMN updated_at timestamptz;
CREATE TABLE outreach.correction_status_changes (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES outreach.corrections ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  previous_status text NOT NULL CHECK(previous_status IN ('Open','Reviewed')),
  status text NOT NULL CHECK(status IN ('Open','Reviewed')),
  expected_version integer NOT NULL CHECK(expected_version>=0),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(report_id,expected_version)
);
ALTER TABLE outreach.correction_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach.correction_status_changes FROM PUBLIC;
CREATE ROLE jco_correction_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $roles$ BEGIN EXECUTE format('GRANT jco_correction_executor TO %I',current_user); END $roles$;
GRANT USAGE,CREATE ON SCHEMA outreach TO jco_correction_executor;
GRANT SELECT ON outreach.deployment,outreach.campaigns,outreach.assignments,outreach.households,outreach.people,outreach.visits,outreach.operations,outreach.corrections,outreach.correction_status_changes TO jco_correction_executor;
GRANT UPDATE(status,version,updated_at) ON outreach.corrections TO jco_correction_executor;
GRANT INSERT ON outreach.correction_status_changes TO jco_correction_executor;
DO $policies$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['deployment','campaigns','assignments','households','people','visits','operations','corrections','correction_status_changes'] LOOP
    EXECUTE format('CREATE POLICY correction_admin_read ON outreach.%I FOR SELECT TO jco_correction_executor USING(true)',t);
  END LOOP;
END $policies$;
CREATE POLICY correction_admin_update ON outreach.corrections FOR UPDATE TO jco_correction_executor USING(true) WITH CHECK(true);
CREATE POLICY correction_admin_history ON outreach.correction_status_changes FOR INSERT TO jco_correction_executor WITH CHECK(true);

CREATE FUNCTION outreach.correction_queue(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JC503',MESSAGE='Synthetic stage required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=p_campaign AND deletion_at>statement_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='JC404',MESSAGE='Campaign unavailable'; END IF;
  RETURN jsonb_build_object('campaignId',p_campaign,'ready',true,'reports',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'visitId',v.id,'assignmentName',a.name,'address',h.address,'unit',h.unit,
      'person',CASE WHEN p.id IS NOT NULL THEN concat_ws(' ',p.first_name,p.last_name) ELSE NULL END,
      'kind',r.kind,
      'suppressed',h.suppressed,'status',r.status,'version',r.version,'receivedAt',o.received_at,'updatedAt',r.updated_at
    ) ORDER BY o.received_at,r.id)
    FROM outreach.corrections r JOIN outreach.visits v ON v.id=r.visit_id
    JOIN outreach.households h ON h.id=v.household_id AND h.campaign_id=p_campaign
    JOIN outreach.operations o ON o.id=v.operation_id
    JOIN outreach.assignments a ON a.id=o.assignment_id AND a.campaign_id=p_campaign
    LEFT JOIN outreach.people p ON p.id=r.person_id AND p.household_id=h.id
  ),'[]'::jsonb));
END $body$;

CREATE FUNCTION outreach.update_correction_status(p_id uuid,p_campaign uuid,p_report uuid,p_expected integer,p_status text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE r record; previous record; deadline timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JC503',MESSAGE='Synthetic stage required'; END IF;
  IF p_id IS NULL OR p_campaign IS NULL OR p_report IS NULL OR p_actor IS NULL OR p_expected IS NULL OR p_expected<0 OR p_expected>2147483646 OR p_status IS NULL OR p_status NOT IN ('Open','Reviewed') THEN RAISE EXCEPTION USING ERRCODE='JC422',MESSAGE='Invalid update'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401837));
  SELECT deletion_at INTO deadline FROM outreach.campaigns WHERE id=p_campaign;
  IF NOT FOUND OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JC404',MESSAGE='Campaign unavailable'; END IF;
  SELECT * INTO previous FROM outreach.correction_status_changes WHERE id=p_id;
  IF FOUND THEN
    IF previous.campaign_id<>p_campaign OR previous.report_id<>p_report OR previous.actor_id<>p_actor OR previous.expected_version<>p_expected OR previous.status<>p_status THEN RAISE EXCEPTION USING ERRCODE='JC409',MESSAGE='Update identifier conflict'; END IF;
    RETURN jsonb_build_object('id',p_id,'campaignId',p_campaign,'reportId',p_report,'status',p_status,'version',p_expected+1);
  END IF;
  SELECT q.status,q.version INTO r FROM outreach.corrections q
    JOIN outreach.visits v ON v.id=q.visit_id JOIN outreach.households h ON h.id=v.household_id
    JOIN outreach.operations o ON o.id=v.operation_id JOIN outreach.assignments a ON a.id=o.assignment_id
    WHERE q.id=p_report AND h.campaign_id=p_campaign AND a.campaign_id=p_campaign FOR UPDATE OF q;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JC404',MESSAGE='Request unavailable'; END IF;
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JC404',MESSAGE='Campaign unavailable'; END IF;
  IF r.version<>p_expected THEN RAISE EXCEPTION USING ERRCODE='JC409',MESSAGE='Request changed'; END IF;
  IF r.status=p_status THEN RAISE EXCEPTION USING ERRCODE='JC409',MESSAGE='Invalid status transition'; END IF;
  INSERT INTO outreach.correction_status_changes(id,campaign_id,report_id,actor_id,previous_status,status,expected_version)
    VALUES(p_id,p_campaign,p_report,p_actor,r.status,p_status,p_expected);
  UPDATE outreach.corrections SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=p_report;
  RETURN jsonb_build_object('id',p_id,'campaignId',p_campaign,'reportId',p_report,'status',p_status,'version',p_expected+1);
END $body$;

REVOKE ALL ON FUNCTION outreach.correction_queue(uuid),outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON outreach.correction_status_changes FROM %I',r.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.correction_queue(uuid),outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid) FROM %I',r.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.correction_queue(uuid) OWNER TO jco_correction_executor;
ALTER FUNCTION outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid) OWNER TO jco_correction_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_correction_executor;
GRANT EXECUTE ON FUNCTION outreach.correction_queue(uuid),outreach.update_correction_status(uuid,uuid,uuid,integer,text,uuid) TO jco_admin_reader;
