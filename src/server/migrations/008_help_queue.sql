-- Administrator-only campaign help queue. Does not change field submissions or create requests.
ALTER TABLE outreach.help_requests ADD COLUMN version integer NOT NULL DEFAULT 0 CHECK(version>=0);
ALTER TABLE outreach.help_requests ADD COLUMN updated_at timestamptz;
CREATE TABLE outreach.help_status_changes (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES outreach.help_requests ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  previous_status text NOT NULL CHECK(previous_status IN ('New','In progress')),
  status text NOT NULL CHECK(status IN ('In progress','Resolved')),
  expected_version integer NOT NULL CHECK(expected_version>=0),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,expected_version)
);
ALTER TABLE outreach.help_status_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach.help_status_changes FROM PUBLIC;
CREATE ROLE jco_help_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $roles$ BEGIN EXECUTE format('GRANT jco_help_executor TO %I',current_user); END $roles$;
GRANT USAGE,CREATE ON SCHEMA outreach TO jco_help_executor;
GRANT SELECT ON outreach.deployment,outreach.campaigns,outreach.assignments,outreach.households,outreach.people,outreach.visits,outreach.operations,outreach.help_requests,outreach.help_status_changes TO jco_help_executor;
GRANT UPDATE(status,version,updated_at) ON outreach.help_requests TO jco_help_executor;
GRANT INSERT ON outreach.help_status_changes TO jco_help_executor;
DO $policies$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['deployment','campaigns','assignments','households','people','visits','operations','help_requests','help_status_changes'] LOOP
    EXECUTE format('CREATE POLICY help_admin_read ON outreach.%I FOR SELECT TO jco_help_executor USING(true)',t);
  END LOOP;
END $policies$;
CREATE POLICY help_admin_update ON outreach.help_requests FOR UPDATE TO jco_help_executor USING(true) WITH CHECK(true);
CREATE POLICY help_admin_history ON outreach.help_status_changes FOR INSERT TO jco_help_executor WITH CHECK(true);

CREATE FUNCTION outreach.help_queue(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JH503',MESSAGE='Synthetic stage required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=p_campaign AND deletion_at>statement_timestamp()) THEN RAISE EXCEPTION USING ERRCODE='JH404',MESSAGE='Campaign unavailable'; END IF;
  RETURN jsonb_build_object('campaignId',p_campaign,'ready',true,'requests',coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'visitId',v.id,'assignmentName',a.name,'address',h.address,'unit',h.unit,
      'requester',CASE WHEN p.id IS NOT NULL THEN concat_ws(' ',p.first_name,p.last_name) ELSE NULL END,
      'phone',CASE WHEN r.consent THEN r.phone ELSE '' END,'consent',r.consent,'arrangement',r.arrangement,
      'suppressed',h.suppressed,'status',r.status,'version',r.version,'receivedAt',o.received_at,'updatedAt',r.updated_at
    ) ORDER BY o.received_at,r.id)
    FROM outreach.help_requests r JOIN outreach.visits v ON v.id=r.visit_id
    JOIN outreach.households h ON h.id=v.household_id AND h.campaign_id=p_campaign
    JOIN outreach.operations o ON o.id=v.operation_id
    JOIN outreach.assignments a ON a.id=o.assignment_id AND a.campaign_id=p_campaign
    LEFT JOIN outreach.people p ON p.id=r.person_id AND p.household_id=h.id
  ),'[]'::jsonb));
END $body$;

CREATE FUNCTION outreach.update_help_status(p_id uuid,p_campaign uuid,p_request uuid,p_expected integer,p_status text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE r record; previous record; deadline timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JH503',MESSAGE='Synthetic stage required'; END IF;
  IF p_id IS NULL OR p_campaign IS NULL OR p_request IS NULL OR p_actor IS NULL OR p_expected IS NULL OR p_expected<0 OR p_expected>2147483646 OR p_status IS NULL OR p_status NOT IN ('In progress','Resolved') THEN RAISE EXCEPTION USING ERRCODE='JH422',MESSAGE='Invalid update'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401836));
  SELECT deletion_at INTO deadline FROM outreach.campaigns WHERE id=p_campaign;
  IF NOT FOUND OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JH404',MESSAGE='Campaign unavailable'; END IF;
  SELECT * INTO previous FROM outreach.help_status_changes WHERE id=p_id;
  IF FOUND THEN
    IF previous.campaign_id<>p_campaign OR previous.request_id<>p_request OR previous.actor_id<>p_actor OR previous.expected_version<>p_expected OR previous.status<>p_status THEN RAISE EXCEPTION USING ERRCODE='JH409',MESSAGE='Update identifier conflict'; END IF;
    RETURN jsonb_build_object('id',p_id,'campaignId',p_campaign,'requestId',p_request,'status',p_status,'version',p_expected+1);
  END IF;
  SELECT q.status,q.version INTO r FROM outreach.help_requests q
    JOIN outreach.visits v ON v.id=q.visit_id JOIN outreach.households h ON h.id=v.household_id
    JOIN outreach.operations o ON o.id=v.operation_id JOIN outreach.assignments a ON a.id=o.assignment_id
    WHERE q.id=p_request AND h.campaign_id=p_campaign AND a.campaign_id=p_campaign FOR UPDATE OF q;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JH404',MESSAGE='Request unavailable'; END IF;
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JH404',MESSAGE='Campaign unavailable'; END IF;
  IF r.version<>p_expected THEN RAISE EXCEPTION USING ERRCODE='JH409',MESSAGE='Request changed'; END IF;
  IF NOT ((r.status='New' AND p_status='In progress') OR (r.status='In progress' AND p_status='Resolved')) THEN RAISE EXCEPTION USING ERRCODE='JH409',MESSAGE='Invalid status transition'; END IF;
  INSERT INTO outreach.help_status_changes(id,campaign_id,request_id,actor_id,previous_status,status,expected_version)
    VALUES(p_id,p_campaign,p_request,p_actor,r.status,p_status,p_expected);
  UPDATE outreach.help_requests SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE id=p_request;
  RETURN jsonb_build_object('id',p_id,'campaignId',p_campaign,'requestId',p_request,'status',p_status,'version',p_expected+1);
END $body$;

REVOKE ALL ON FUNCTION outreach.help_queue(uuid),outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON outreach.help_status_changes FROM %I',r.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.help_queue(uuid),outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid) FROM %I',r.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.help_queue(uuid) OWNER TO jco_help_executor;
ALTER FUNCTION outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid) OWNER TO jco_help_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_help_executor;
GRANT EXECUTE ON FUNCTION outreach.help_queue(uuid),outreach.update_help_status(uuid,uuid,uuid,integer,text,uuid) TO jco_admin_reader;
