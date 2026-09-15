-- Move selected active doors into a new same-event assignment. Never revoke links or erase visits.
CREATE TABLE outreach.reassignments (
  id uuid PRIMARY KEY REFERENCES outreach.assignments ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES outreach.assignments ON DELETE CASCADE,
  name text NOT NULL,
  household_ids uuid[] NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE outreach.reassignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach.reassignments FROM PUBLIC;
GRANT SELECT,INSERT ON outreach.reassignments TO jco_assignment_executor;
GRANT UPDATE(state) ON outreach.memberships TO jco_assignment_executor;
CREATE POLICY reassignment_read ON outreach.reassignments FOR SELECT TO jco_assignment_executor USING(campaign_id IN (SELECT id FROM outreach.campaigns));
CREATE POLICY reassignment_insert ON outreach.reassignments FOR INSERT TO jco_assignment_executor WITH CHECK(campaign_id IN (SELECT id FROM outreach.campaigns));
CREATE POLICY reassignment_membership_update ON outreach.memberships FOR UPDATE TO jco_assignment_executor USING(campaign_id IN (SELECT id FROM outreach.campaigns)) WITH CHECK(campaign_id IN (SELECT id FROM outreach.campaigns));
GRANT CREATE ON SCHEMA outreach TO jco_assignment_executor;

CREATE FUNCTION outreach.reassign_households(p_id uuid,p_campaign uuid,p_source uuid,p_name text,p_households uuid[],p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE source outreach.assignments%ROWTYPE; prior outreach.reassignments%ROWTYPE; deadline timestamptz; ending timestamptz; moved integer;
BEGIN
  PERFORM outreach.assignment_workspace(p_campaign);
  IF p_id IS NULL OR p_actor IS NULL OR p_source IS NULL OR p_id=p_source OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]' OR p_households IS NULL OR cardinality(p_households) NOT BETWEEN 1 AND 1000 OR array_ndims(p_households)<>1 OR array_position(p_households,NULL) IS NOT NULL OR cardinality(p_households)<>(SELECT count(DISTINCT value) FROM unnest(p_households) value) THEN RAISE EXCEPTION USING ERRCODE='JR422',MESSAGE='Invalid reassignment'; END IF;
  -- Shared with ordinary creation: a target ID cannot be used by two different saves.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401833));
  SELECT deletion_at INTO deadline FROM outreach.campaigns WHERE id=p_campaign;
  IF NOT FOUND OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JR404',MESSAGE='Campaign unavailable'; END IF;
  SELECT * INTO prior FROM outreach.reassignments WHERE id=p_id;
  IF FOUND THEN
    IF prior.campaign_id IS DISTINCT FROM p_campaign OR prior.source_id IS DISTINCT FROM p_source OR prior.name IS DISTINCT FROM btrim(p_name) OR prior.household_ids IS DISTINCT FROM p_households OR prior.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION USING ERRCODE='JR409',MESSAGE='Reassignment ID conflict'; END IF;
    RETURN prior.id;
  END IF;
  IF EXISTS(SELECT 1 FROM outreach.assignments WHERE id=p_id) THEN RAISE EXCEPTION USING ERRCODE='JR409',MESSAGE='Target must be a new assignment'; END IF;
  -- Shared with field download/submit/revoke. Existing offline work remains authorized.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source::text,73401834));
  SELECT * INTO source FROM outreach.assignments WHERE id=p_source AND campaign_id=p_campaign AND event_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JR404',MESSAGE='Source unavailable'; END IF;
  SELECT ends_at INTO ending FROM outreach.events WHERE id=source.event_id AND campaign_id=p_campaign;
  IF ending IS NULL OR ending<=clock_timestamp() OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JR422',MESSAGE='Active event required'; END IF;
  PERFORM m.household_id FROM outreach.memberships m WHERE m.assignment_id=p_source AND m.household_id=ANY(p_households) ORDER BY m.household_id FOR UPDATE;
  IF (SELECT count(*) FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id AND h.campaign_id=p_campaign WHERE m.assignment_id=p_source AND m.event_id=source.event_id AND m.campaign_id=p_campaign AND m.state='active' AND m.household_id=ANY(p_households) AND NOT h.suppressed)<>cardinality(p_households) THEN RAISE EXCEPTION USING ERRCODE='JR409',MESSAGE='Selected doors changed or suppressed'; END IF;
  UPDATE outreach.memberships SET state='superseded' WHERE assignment_id=p_source AND household_id=ANY(p_households) AND state='active';
  GET DIAGNOSTICS moved=ROW_COUNT;
  IF moved<>cardinality(p_households) THEN RAISE EXCEPTION USING ERRCODE='JR409',MESSAGE='Selected doors changed'; END IF;
  PERFORM outreach.prepare_assignment(p_id,p_campaign,source.event_id,btrim(p_name),source.kind,p_households,p_actor);
  IF ending<=clock_timestamp() OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JR422',MESSAGE='Event ended'; END IF;
  INSERT INTO outreach.reassignments(id,campaign_id,source_id,name,household_ids,actor_id) VALUES(p_id,p_campaign,p_source,btrim(p_name),p_households,p_actor);
  RETURN p_id;
END $body$;

REVOKE ALL ON FUNCTION outreach.reassign_households(uuid,uuid,uuid,text,uuid[],uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON outreach.reassignments FROM %I',r.rolname);
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.reassign_households(uuid,uuid,uuid,text,uuid[],uuid) FROM %I',r.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.reassign_households(uuid,uuid,uuid,text,uuid[],uuid) OWNER TO jco_assignment_executor;
GRANT EXECUTE ON FUNCTION outreach.reassign_households(uuid,uuid,uuid,text,uuid[],uuid) TO jco_admin_reader;

CREATE OR REPLACE FUNCTION outreach.assignment_workspace(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE campaign outreach.campaigns%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN
    RAISE EXCEPTION USING ERRCODE='JA004',MESSAGE='Synthetic deployment required';
  END IF;
  SELECT * INTO campaign FROM outreach.campaigns WHERE id=p_campaign AND end_at IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM outreach.imports WHERE campaign_id=p_campaign) THEN
    RAISE EXCEPTION USING ERRCODE='JA001',MESSAGE='Imported campaign unavailable or expired';
  END IF;
  RETURN jsonb_build_object('reassignmentReady',true,'campaignId',campaign.id,'endAt',campaign.end_at,'deletionAt',campaign.deletion_at,
    'households',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'ward',b.ward,'suppressed',h.suppressed,'peopleCount',(SELECT count(*) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY h.address,h.unit,h.id) FROM outreach.households h JOIN outreach.buildings b ON b.id=h.building_id AND b.campaign_id=h.campaign_id WHERE h.campaign_id=p_campaign),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'endsAt',e.ends_at) ORDER BY e.ends_at,e.id) FROM outreach.events e WHERE e.campaign_id=p_campaign),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'eventId',a.event_id,'name',a.name,'kind',a.kind,'supersededHouseholdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='superseded'),'householdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='active')) ORDER BY a.name,a.id) FROM outreach.assignments a WHERE a.campaign_id=p_campaign AND a.event_id IS NOT NULL),'[]'::jsonb));
END $body$;

GRANT CREATE ON SCHEMA outreach TO jco_field_executor,jco_field_admin_executor;
CREATE OR REPLACE FUNCTION outreach.download_field_assignment(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb;
BEGIN
  a:=outreach.field_access(p_hash,false);
  RETURN a||jsonb_build_object('synthetic',true,'supersededHouseholdIds',coalesce((SELECT jsonb_agg(m.household_id ORDER BY m.position) FROM outreach.memberships m WHERE m.assignment_id=(a->>'id')::uuid AND m.state='superseded'),'[]'::jsonb),'households',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',h.id,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'suppressed',h.suppressed,
      'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'firstName',p.first_name,'lastName',p.last_name) ORDER BY p.first_name,p.id),'[]'::jsonb) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY m.position)
    FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
    WHERE m.assignment_id=(a->>'id')::uuid AND m.state='active' AND h.campaign_id=(a->>'campaignId')::uuid
  ),'[]'::jsonb));
END $body$;

CREATE OR REPLACE FUNCTION outreach.field_admin_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Synthetic stage required'; END IF;
  SELECT s.id,e.ends_at,c.deletion_at INTO a FROM outreach.assignments s JOIN outreach.events e ON e.id=s.event_id AND e.campaign_id=s.campaign_id JOIN outreach.campaigns c ON c.id=s.campaign_id WHERE s.id=p_assignment AND c.deletion_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF404',MESSAGE='Assignment unavailable'; END IF;
  RETURN jsonb_build_object('assignmentId',a.id,'eventEndsAt',a.ends_at,'uploadEndsAt',least(a.ends_at+interval '72 hours',a.deletion_at),'deletionAt',a.deletion_at,'labelsReady',true,
    'credentials',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'label',label,'issuedAt',issued_at,'revoked',revoked,'revokedAt',revoked_at) ORDER BY issued_at,id) FROM outreach.credentials WHERE assignment_id=a.id AND id IS NOT NULL),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'address',h.address,'unit',h.unit,'result',v.result,'receivedAt',o.received_at,'superseded',EXISTS(SELECT 1 FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.household_id=h.id AND m.state='superseded')) ORDER BY o.received_at DESC,v.id) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id JOIN outreach.households h ON h.id=v.household_id WHERE o.assignment_id=a.id),'[]'::jsonb),
    'counts',(SELECT jsonb_build_object('attempts',count(DISTINCT v.household_id),'repeats',count(*)-count(DISTINCT v.household_id),'conversations',count(*) FILTER(WHERE v.result IN ('resident','other'))) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'buildingFailures',(SELECT count(*) FROM outreach.building_attempts b JOIN outreach.operations o ON o.id=b.operation_id WHERE o.assignment_id=a.id),
    'helpRequests',(SELECT count(*) FROM outreach.help_requests h JOIN outreach.visits v ON v.id=h.visit_id JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'latestReceivedAt',(SELECT max(received_at) FROM outreach.operations WHERE assignment_id=a.id));
END $body$;
REVOKE CREATE ON SCHEMA outreach FROM jco_assignment_executor,jco_field_executor,jco_field_admin_executor;
