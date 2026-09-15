-- Hosted synthetic event/assignment preparation only. No volunteer credentials issued.
CREATE TABLE outreach.events (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  ends_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  UNIQUE(id,campaign_id)
);
ALTER TABLE outreach.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.assignments ADD COLUMN event_id uuid;
ALTER TABLE outreach.assignments ADD COLUMN kind text NOT NULL DEFAULT 'scattered' CHECK(kind IN ('building','scattered'));
ALTER TABLE outreach.assignments ADD COLUMN created_by uuid;
ALTER TABLE outreach.assignments ADD CONSTRAINT assignment_event_campaign FOREIGN KEY(event_id,campaign_id) REFERENCES outreach.events(id,campaign_id) ON DELETE CASCADE;
ALTER TABLE outreach.assignments ADD CONSTRAINT assignment_creator CHECK((event_id IS NULL AND created_by IS NULL) OR (event_id IS NOT NULL AND created_by IS NOT NULL));
ALTER TABLE outreach.assignments ADD CONSTRAINT assignment_membership_scope UNIQUE(id,event_id,campaign_id);
ALTER TABLE outreach.households ADD CONSTRAINT household_membership_scope UNIQUE(id,campaign_id);
ALTER TABLE outreach.memberships ADD COLUMN event_id uuid;
ALTER TABLE outreach.memberships ADD COLUMN campaign_id uuid;
ALTER TABLE outreach.memberships ADD COLUMN state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','superseded'));
ALTER TABLE outreach.memberships ADD CONSTRAINT membership_scope_present CHECK((event_id IS NULL AND campaign_id IS NULL) OR (event_id IS NOT NULL AND campaign_id IS NOT NULL));
ALTER TABLE outreach.memberships ADD CONSTRAINT membership_assignment_scope FOREIGN KEY(assignment_id,event_id,campaign_id) REFERENCES outreach.assignments(id,event_id,campaign_id) ON DELETE CASCADE;
ALTER TABLE outreach.memberships ADD CONSTRAINT membership_household_scope FOREIGN KEY(household_id,campaign_id) REFERENCES outreach.households(id,campaign_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX one_active_household_per_event ON outreach.memberships(event_id,household_id) WHERE state='active';
CREATE UNIQUE INDEX assignment_household_position ON outreach.memberships(assignment_id,position);

CREATE ROLE jco_assignment_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $membership$ BEGIN
  EXECUTE format('GRANT jco_assignment_executor TO %I',current_user);
END $membership$;
GRANT USAGE,CREATE ON SCHEMA outreach TO jco_assignment_executor;
GRANT SELECT ON outreach.deployment,outreach.campaigns,outreach.imports,outreach.buildings,outreach.households,outreach.events,outreach.assignments,outreach.memberships TO jco_assignment_executor;
GRANT SELECT(household_id) ON outreach.people TO jco_assignment_executor;
GRANT INSERT ON outreach.events,outreach.assignments,outreach.memberships TO jco_assignment_executor;
REVOKE ALL ON outreach.events FROM PUBLIC;
DO $clients$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON outreach.events FROM %I',item.rolname);
  END LOOP;
END $clients$;
CREATE POLICY assignment_executor_stage ON outreach.deployment FOR SELECT TO jco_assignment_executor USING(true);
CREATE POLICY assignment_executor_campaigns ON outreach.campaigns FOR SELECT TO jco_assignment_executor USING(deletion_at>now());
DO $policies$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['imports','buildings','households','events','assignments','memberships'] LOOP
    EXECUTE format('CREATE POLICY assignment_executor_read ON outreach.%I FOR SELECT TO jco_assignment_executor USING(campaign_id IN (SELECT id FROM outreach.campaigns))',table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['events','assignments','memberships'] LOOP
    EXECUTE format('CREATE POLICY assignment_executor_insert ON outreach.%I FOR INSERT TO jco_assignment_executor WITH CHECK(campaign_id IN (SELECT id FROM outreach.campaigns))',table_name);
  END LOOP;
END $policies$;
CREATE POLICY assignment_executor_people ON outreach.people FOR SELECT TO jco_assignment_executor USING(household_id IN (SELECT id FROM outreach.households));

CREATE FUNCTION outreach.assignment_workspace(p_campaign uuid)
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
  RETURN jsonb_build_object('campaignId',campaign.id,'endAt',campaign.end_at,'deletionAt',campaign.deletion_at,
    'households',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'ward',b.ward,'suppressed',h.suppressed,'peopleCount',(SELECT count(*) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY h.address,h.unit,h.id) FROM outreach.households h JOIN outreach.buildings b ON b.id=h.building_id AND b.campaign_id=h.campaign_id WHERE h.campaign_id=p_campaign),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'endsAt',e.ends_at) ORDER BY e.ends_at,e.id) FROM outreach.events e WHERE e.campaign_id=p_campaign),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'eventId',a.event_id,'name',a.name,'kind',a.kind,'householdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='active')) ORDER BY a.name,a.id) FROM outreach.assignments a WHERE a.campaign_id=p_campaign AND a.event_id IS NOT NULL),'[]'::jsonb));
END $body$;

CREATE FUNCTION outreach.create_outreach_event(p_id uuid,p_campaign uuid,p_name text,p_end date,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE campaign outreach.campaigns%ROWTYPE; saved outreach.events%ROWTYPE; ending timestamptz;
BEGIN
  PERFORM outreach.assignment_workspace(p_campaign);
  IF p_id IS NULL OR p_actor IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]' OR p_end IS NULL OR p_end<date '2000-01-01' OR p_end>date '9998-12-31' THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='Invalid event fields';
  END IF;
  ending := (p_end+time '17:00:00') AT TIME ZONE 'America/New_York';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401832));
  SELECT * INTO saved FROM outreach.events WHERE id=p_id;
  IF FOUND THEN
    IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.name IS DISTINCT FROM btrim(p_name) OR saved.ends_at IS DISTINCT FROM ending OR saved.created_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION USING ERRCODE='JA003',MESSAGE='Event save conflicts';
    END IF;
    RETURN saved.id;
  END IF;
  SELECT * INTO campaign FROM outreach.campaigns WHERE id=p_campaign;
  IF ending<=now() OR ending>campaign.end_at THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='Event must end in the future within the campaign';
  END IF;
  INSERT INTO outreach.events(id,campaign_id,name,ends_at,created_by) VALUES(p_id,p_campaign,btrim(p_name),ending,p_actor);
  RETURN p_id;
END $body$;

CREATE FUNCTION outreach.prepare_assignment(p_id uuid,p_campaign uuid,p_event uuid,p_name text,p_kind text,p_households uuid[],p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE event outreach.events%ROWTYPE; saved outreach.assignments%ROWTYPE; old_ids uuid[]; item uuid; ordinal bigint;
BEGIN
  PERFORM outreach.assignment_workspace(p_campaign);
  IF p_id IS NULL OR p_actor IS NULL OR p_event IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]' OR p_kind IS NULL OR p_kind NOT IN ('building','scattered') OR p_households IS NULL OR cardinality(p_households) NOT BETWEEN 1 AND 1000 OR array_ndims(p_households)<>1 OR array_position(p_households,NULL) IS NOT NULL OR cardinality(p_households)<>(SELECT count(DISTINCT value) FROM unnest(p_households) value) THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='Invalid assignment fields';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401833));
  SELECT * INTO saved FROM outreach.assignments WHERE id=p_id;
  IF FOUND THEN
    SELECT array_agg(household_id ORDER BY position) INTO old_ids FROM outreach.memberships WHERE assignment_id=p_id;
    IF saved.campaign_id IS DISTINCT FROM p_campaign OR saved.event_id IS DISTINCT FROM p_event OR saved.name IS DISTINCT FROM btrim(p_name) OR saved.kind IS DISTINCT FROM p_kind OR saved.created_by IS DISTINCT FROM p_actor OR old_ids IS DISTINCT FROM p_households THEN
      RAISE EXCEPTION USING ERRCODE='JA003',MESSAGE='Assignment save conflicts';
    END IF;
    RETURN saved.id;
  END IF;
  SELECT * INTO event FROM outreach.events WHERE id=p_event AND campaign_id=p_campaign;
  IF NOT FOUND OR event.ends_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='Choose an active event in this campaign';
  END IF;
  IF (SELECT count(*) FROM outreach.households WHERE id=ANY(p_households) AND campaign_id=p_campaign AND NOT suppressed)<>cardinality(p_households) THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='Choose only unsuppressed households in this campaign';
  END IF;
  IF p_kind='building' AND (SELECT count(DISTINCT building_id) FROM outreach.households WHERE id=ANY(p_households) AND campaign_id=p_campaign)<>1 THEN
    RAISE EXCEPTION USING ERRCODE='JA002',MESSAGE='A building run must contain one building';
  END IF;
  INSERT INTO outreach.assignments(id,campaign_id,name,event_name,event_ends_at,event_id,kind,created_by) VALUES(p_id,p_campaign,btrim(p_name),event.name,event.ends_at,p_event,p_kind,p_actor);
  FOR item,ordinal IN SELECT value,position FROM unnest(p_households) WITH ORDINALITY AS h(value,position) LOOP
    INSERT INTO outreach.memberships(assignment_id,household_id,position,event_id,campaign_id,state) VALUES(p_id,item,ordinal-1,p_event,p_campaign,'active');
  END LOOP;
  RETURN p_id;
END $body$;

REVOKE ALL ON FUNCTION outreach.assignment_workspace(uuid),outreach.create_outreach_event(uuid,uuid,text,date,uuid),outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid) FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.assignment_workspace(uuid),outreach.create_outreach_event(uuid,uuid,text,date,uuid),outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid) FROM %I',item.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.assignment_workspace(uuid) OWNER TO jco_assignment_executor;
ALTER FUNCTION outreach.create_outreach_event(uuid,uuid,text,date,uuid) OWNER TO jco_assignment_executor;
ALTER FUNCTION outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid) OWNER TO jco_assignment_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_assignment_executor;
GRANT EXECUTE ON FUNCTION outreach.assignment_workspace(uuid),outreach.create_outreach_event(uuid,uuid,text,date,uuid),outreach.prepare_assignment(uuid,uuid,uuid,text,text,uuid[],uuid) TO jco_admin_reader;
