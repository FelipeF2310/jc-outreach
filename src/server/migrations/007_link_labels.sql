-- Organizer labels only: access tokens, assignment scope and visit history are unchanged.
ALTER TABLE outreach.credentials ADD COLUMN label text
  CHECK (label IS NULL OR (length(label) BETWEEN 1 AND 100 AND label=btrim(label) AND label !~ '[[:cntrl:]]'));
GRANT UPDATE(label) ON outreach.credentials TO jco_field_admin_executor;
GRANT CREATE ON SCHEMA outreach TO jco_field_admin_executor;

CREATE OR REPLACE FUNCTION outreach.field_admin_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Synthetic stage required'; END IF;
  SELECT s.id,e.ends_at,c.deletion_at INTO a FROM outreach.assignments s JOIN outreach.events e ON e.id=s.event_id AND e.campaign_id=s.campaign_id JOIN outreach.campaigns c ON c.id=s.campaign_id WHERE s.id=p_assignment AND c.deletion_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF404',MESSAGE='Assignment unavailable'; END IF;
  RETURN jsonb_build_object('assignmentId',a.id,'eventEndsAt',a.ends_at,'uploadEndsAt',least(a.ends_at+interval '72 hours',a.deletion_at),'deletionAt',a.deletion_at,'labelsReady',true,
    'credentials',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'issuedAt',issued_at,'revoked',revoked,'revokedAt',revoked_at) ORDER BY issued_at,id) FROM outreach.credentials WHERE assignment_id=a.id AND id IS NOT NULL),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'address',h.address,'unit',h.unit,'result',v.result,'receivedAt',o.received_at) ORDER BY o.received_at DESC,v.id) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id JOIN outreach.households h ON h.id=v.household_id WHERE o.assignment_id=a.id),'[]'::jsonb),
    'counts',(SELECT jsonb_build_object('attempts',count(DISTINCT v.household_id),'repeats',count(*)-count(DISTINCT v.household_id),'conversations',count(*) FILTER(WHERE v.result IN ('resident','other'))) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'buildingFailures',(SELECT count(*) FROM outreach.building_attempts b JOIN outreach.operations o ON o.id=b.operation_id WHERE o.assignment_id=a.id),
    'helpRequests',(SELECT count(*) FROM outreach.help_requests h JOIN outreach.visits v ON v.id=h.visit_id JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'latestReceivedAt',(SELECT max(received_at) FROM outreach.operations WHERE assignment_id=a.id));
END $body$;

CREATE FUNCTION outreach.issue_field_credential(p_id uuid,p_assignment uuid,p_hash text,p_actor uuid,p_label text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE created boolean; saved_label text;
BEGIN
  IF p_label IS NULL OR length(p_label) NOT BETWEEN 1 AND 100 OR p_label<>btrim(p_label) OR p_label ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid link label';
  END IF;
  -- Reuse the existing scope/lifecycle/actor checks and the same lock ordering.
  -- The caller's transaction commits the credential and its label together.
  created:=outreach.issue_field_credential(p_id,p_assignment,p_hash,p_actor);
  IF created THEN
    UPDATE outreach.credentials SET label=p_label WHERE id=p_id AND assignment_id=p_assignment;
  ELSE
    SELECT label INTO saved_label FROM outreach.credentials WHERE id=p_id AND assignment_id=p_assignment;
    IF saved_label IS DISTINCT FROM p_label THEN
      RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Credential label conflict';
    END IF;
  END IF;
  RETURN created;
END $body$;

REVOKE ALL ON FUNCTION outreach.issue_field_credential(uuid,uuid,text,uuid,text) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.issue_field_credential(uuid,uuid,text,uuid,text) FROM %I',r.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.issue_field_credential(uuid,uuid,text,uuid,text) OWNER TO jco_field_admin_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_field_admin_executor;
GRANT EXECUTE ON FUNCTION outreach.issue_field_credential(uuid,uuid,text,uuid,text) TO jco_admin_reader;
