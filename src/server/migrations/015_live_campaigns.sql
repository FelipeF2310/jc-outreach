-- Additive live-mode capability. Installation alone DOES NOT activate real data.
-- Existing campaigns remain synthetic; existing deadlines/data/ACLs stay intact.
ALTER TABLE outreach.deployment DROP CONSTRAINT deployment_stage_check;
ALTER TABLE outreach.deployment ADD CONSTRAINT deployment_stage_check
  CHECK(stage IN ('synthetic-preview','outreach-live'));
ALTER TABLE outreach.campaigns ADD COLUMN data_kind text NOT NULL DEFAULT 'synthetic'
  CHECK(data_kind IN ('synthetic','live'));
-- Once resident campaigns exist, do not reclassify their database as a preview.
-- Roll back application releases to a compatible live-mode build instead.
CREATE FUNCTION outreach.prevent_live_downgrade() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NEW.stage='synthetic-preview' AND OLD.stage='outreach-live'
    AND EXISTS(SELECT 1 FROM outreach.campaigns WHERE data_kind='live') THEN
    RAISE EXCEPTION USING ERRCODE='JC004',MESSAGE='Live campaigns prevent a synthetic downgrade';
  END IF;
  RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION outreach.prevent_live_downgrade() FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.prevent_live_downgrade() FROM %I',item.rolname);
  END LOOP;
END $acl$;
CREATE TRIGGER prevent_live_downgrade BEFORE UPDATE OF stage ON outreach.deployment
  FOR EACH ROW EXECUTE FUNCTION outreach.prevent_live_downgrade();
GRANT INSERT(data_kind) ON outreach.campaigns TO jco_campaign_executor;
ALTER POLICY campaign_executor_insert ON outreach.campaigns WITH CHECK (
  end_at>now() AND created_by IS NOT NULL AND
  ((data_kind='synthetic' AND name LIKE 'Synthetic: %') OR
   (data_kind='live' AND EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='outreach-live')))
);

GRANT CREATE ON SCHEMA outreach TO jco_campaign_executor;
CREATE FUNCTION outreach.create_live_campaign(p_id uuid,p_name text,p_end date,p_actor uuid)
RETURNS TABLE(id uuid,name text,end_at timestamptz,deletion_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE saved outreach.campaigns%ROWTYPE; ends timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='outreach-live') THEN
    RAISE EXCEPTION USING ERRCODE='JC004',MESSAGE='Live deployment is not approved';
  END IF;
  IF p_id IS NULL OR p_actor IS NULL OR p_end IS NULL OR p_name IS NULL
    OR length(btrim(p_name)) NOT BETWEEN 1 AND 100 OR p_name ~ '[[:cntrl:]]'
    OR p_name LIKE 'Synthetic: %' OR p_end<date '2000-01-01' OR p_end>date '9998-12-31' THEN
    RAISE EXCEPTION USING ERRCODE='JC001',MESSAGE='Invalid campaign fields';
  END IF;
  ends:=(p_end+time '23:59:59') AT TIME ZONE 'America/New_York';
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401830));
  SELECT c.* INTO saved FROM outreach.campaigns c WHERE c.id=p_id;
  IF FOUND THEN
    IF saved.data_kind IS DISTINCT FROM 'live' OR saved.name IS DISTINCT FROM btrim(p_name)
      OR saved.end_at IS DISTINCT FROM ends OR saved.created_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Campaign request conflicts with saved record';
    END IF;
  ELSE
    IF ends<=now() THEN RAISE EXCEPTION USING ERRCODE='JC001',MESSAGE='Campaign end must be in the future'; END IF;
    INSERT INTO outreach.campaigns AS c(id,name,end_at,deletion_at,created_by,data_kind)
      VALUES(p_id,btrim(p_name),ends,((ends AT TIME ZONE 'America/New_York')+interval '30 days') AT TIME ZONE 'America/New_York',p_actor,'live')
      ON CONFLICT DO NOTHING RETURNING c.* INTO saved;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Campaign identifier unavailable'; END IF;
  END IF;
  RETURN QUERY SELECT saved.id,saved.name,saved.end_at,saved.deletion_at;
END $body$;
REVOKE ALL ON FUNCTION outreach.create_live_campaign(uuid,text,date,uuid) FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.create_live_campaign(uuid,text,date,uuid) FROM %I',item.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.create_live_campaign(uuid,text,date,uuid) OWNER TO jco_campaign_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_campaign_executor;
GRANT EXECUTE ON FUNCTION outreach.create_live_campaign(uuid,text,date,uuid) TO jco_admin_reader;

-- Only stage checks are broadened below, except the explicit source-key admin
-- projection and campaign-kind volunteer flag. Existing function owners, ACLs,
-- scope checks, expiry checks, transactions and search paths are preserved.

-- Reviewed source: 004_synthetic_import.sql, synthetic_import_status.
CREATE OR REPLACE FUNCTION outreach.synthetic_import_status()
RETURNS TABLE(campaign_id uuid, receipt jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
  SELECT i.campaign_id, jsonb_build_object('importId',i.id,'campaignId',i.campaign_id,
    'counts',i.counts,'finalizedAt',i.finalized_at)
  FROM outreach.imports i JOIN outreach.campaigns c ON c.id=i.campaign_id
  WHERE c.deletion_at>now() AND EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live'))
$body$;

-- Reviewed source: 010_reassignment.sql, assignment_workspace.
CREATE OR REPLACE FUNCTION outreach.assignment_workspace(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE campaign outreach.campaigns%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN
    RAISE EXCEPTION USING ERRCODE='JA004',MESSAGE='Reviewed deployment required';
  END IF;
  SELECT * INTO campaign FROM outreach.campaigns WHERE id=p_campaign AND end_at IS NOT NULL;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM outreach.imports WHERE campaign_id=p_campaign) THEN
    RAISE EXCEPTION USING ERRCODE='JA001',MESSAGE='Imported campaign unavailable or expired';
  END IF;
  RETURN jsonb_build_object('reassignmentReady',true,'campaignId',campaign.id,'endAt',campaign.end_at,'deletionAt',campaign.deletion_at,
    'households',coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'sourceKey',h.source_key,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'ward',b.ward,'suppressed',h.suppressed,'peopleCount',(SELECT count(*) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY h.address,h.unit,h.id) FROM outreach.households h JOIN outreach.buildings b ON b.id=h.building_id AND b.campaign_id=h.campaign_id WHERE h.campaign_id=p_campaign),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'endsAt',e.ends_at) ORDER BY e.ends_at,e.id) FROM outreach.events e WHERE e.campaign_id=p_campaign),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'eventId',a.event_id,'name',a.name,'kind',a.kind,'supersededHouseholdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='superseded'),'householdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='active')) ORDER BY a.name,a.id) FROM outreach.assignments a WHERE a.campaign_id=p_campaign AND a.event_id IS NOT NULL),'[]'::jsonb));
END $body$;

-- Reviewed source: 006_hosted_field.sql, field_access.
CREATE OR REPLACE FUNCTION outreach.field_access(p_hash text,p_write boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE aid uuid; a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Reviewed deployment required'; END IF;
  IF p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='JF401',MESSAGE='Invalid link'; END IF;
  SELECT assignment_id INTO aid FROM outreach.credentials WHERE token_hash=p_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF401',MESSAGE='Unknown link'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(aid::text,73401834));
  SELECT s.id,s.campaign_id,s.name,e.name AS event_name,e.ends_at,c.deletion_at,k.revoked INTO a
    FROM outreach.credentials k JOIN outreach.assignments s ON s.id=k.assignment_id
    JOIN outreach.events e ON e.id=s.event_id AND e.campaign_id=s.campaign_id
    JOIN outreach.campaigns c ON c.id=s.campaign_id WHERE k.token_hash=p_hash;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF401',MESSAGE='Unavailable link'; END IF;
  IF a.revoked THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Revoked link'; END IF;
  IF a.deletion_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JF410',MESSAGE='Campaign expired'; END IF;
  IF NOT p_write AND a.ends_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JF405',MESSAGE='Upload only'; END IF;
  IF p_write AND a.ends_at+interval '72 hours'<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='JF410',MESSAGE='Upload window expired'; END IF;
  RETURN jsonb_build_object('id',a.id,'campaignId',a.campaign_id,'name',a.name,'eventName',a.event_name,'eventEndsAt',a.ends_at,'deletionAt',a.deletion_at);
END $body$;

-- Reviewed source: 010_reassignment.sql, download_field_assignment.
CREATE OR REPLACE FUNCTION outreach.download_field_assignment(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb;
BEGIN
  a:=outreach.field_access(p_hash,false);
  RETURN a||jsonb_build_object('synthetic',(SELECT data_kind='synthetic' FROM outreach.campaigns WHERE id=(a->>'campaignId')::uuid),'supersededHouseholdIds',coalesce((SELECT jsonb_agg(m.household_id ORDER BY m.position) FROM outreach.memberships m WHERE m.assignment_id=(a->>'id')::uuid AND m.state='superseded'),'[]'::jsonb),'households',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',h.id,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'suppressed',h.suppressed,
      'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'firstName',p.first_name,'lastName',p.last_name) ORDER BY p.first_name,p.id),'[]'::jsonb) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY m.position)
    FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
    WHERE m.assignment_id=(a->>'id')::uuid AND m.state='active' AND h.campaign_id=(a->>'campaignId')::uuid
  ),'[]'::jsonb));
END $body$;

-- Reviewed source: 010_reassignment.sql, field_admin_snapshot.
CREATE OR REPLACE FUNCTION outreach.field_admin_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Reviewed deployment required'; END IF;
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

-- Reviewed source: 008_help_queue.sql, help_queue.
CREATE OR REPLACE FUNCTION outreach.help_queue(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JH503',MESSAGE='Reviewed deployment required'; END IF;
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

-- Reviewed source: 008_help_queue.sql, update_help_status.
CREATE OR REPLACE FUNCTION outreach.update_help_status(p_id uuid,p_campaign uuid,p_request uuid,p_expected integer,p_status text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE r record; previous record; deadline timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JH503',MESSAGE='Reviewed deployment required'; END IF;
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

-- Reviewed source: 009_correction_queue.sql, correction_queue.
CREATE OR REPLACE FUNCTION outreach.correction_queue(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JC503',MESSAGE='Reviewed deployment required'; END IF;
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

-- Reviewed source: 009_correction_queue.sql, update_correction_status.
CREATE OR REPLACE FUNCTION outreach.update_correction_status(p_id uuid,p_campaign uuid,p_report uuid,p_expected integer,p_status text,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE r record; previous record; deadline timestamptz;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN RAISE EXCEPTION USING ERRCODE='JC503',MESSAGE='Reviewed deployment required'; END IF;
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

-- Reviewed source: 013_retention.sql, run_retention.
CREATE OR REPLACE FUNCTION outreach.run_retention()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $body$
DECLARE item record; removed uuid; deleted_count integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN
  RAISE EXCEPTION USING ERRCODE='JR503',MESSAGE='Reviewed deployment required';
 END IF;
 -- A second runner cannot double-count deletes. Locks release with the transaction.
 IF NOT pg_try_advisory_xact_lock(73401841) THEN RETURN; END IF;
 -- Oldest untried/failed campaigns first prevents a failing record starving others.
 FOR item IN SELECT c.id FROM outreach.campaigns c
  LEFT JOIN outreach.retention_failures f ON f.campaign_id=c.id
  WHERE c.deletion_at <= clock_timestamp()
  ORDER BY f.attempted_at NULLS FIRST,c.deletion_at,c.id LIMIT 50
 LOOP
  BEGIN
   removed:=NULL;
   DELETE FROM outreach.campaigns WHERE id=item.id AND deletion_at<=clock_timestamp() RETURNING id INTO removed;
   IF removed IS NOT NULL THEN deleted_count:=deleted_count+1; END IF;
  EXCEPTION WHEN OTHERS THEN
   -- The subtransaction rolls back ALL cascading deletes. Never retain SQLERRM,
   -- detail, payloads, names or tokens in health records or notices.
   INSERT INTO outreach.retention_failures(campaign_id,attempted_at)
    SELECT id,clock_timestamp() FROM outreach.campaigns WHERE id=item.id
    ON CONFLICT(campaign_id) DO UPDATE SET attempted_at=excluded.attempted_at;
  END;
 END LOOP;
 UPDATE outreach.retention_health SET checked_at=clock_timestamp(),
  deleted_campaigns=deleted_campaigns+deleted_count WHERE singleton;
END $body$;

-- Reviewed source: 013_retention.sql, retention_status.
CREATE OR REPLACE FUNCTION outreach.retention_status(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $body$
DECLARE health outreach.retention_health%ROWTYPE; selected jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN
  RAISE EXCEPTION USING ERRCODE='JR503',MESSAGE='Reviewed deployment required';
 END IF;
 SELECT * INTO STRICT health FROM outreach.retention_health WHERE singleton;
 SELECT jsonb_build_object('campaignId',c.id,'deletionAt',c.deletion_at,
  'openHelpRequests',(SELECT count(*) FROM outreach.help_requests h
    JOIN outreach.visits v ON v.id=h.visit_id JOIN outreach.households hh ON hh.id=v.household_id
    WHERE hh.campaign_id=c.id AND h.status<>'Resolved')) INTO selected
 FROM outreach.campaigns c WHERE c.id=p_campaign AND c.deletion_at>now();
 RETURN jsonb_build_object('ready',true,'checkedAt',health.checked_at,'observedAt',now(),
  'health',CASE WHEN health.checked_at IS NULL THEN 'not_started'
    WHEN health.checked_at<now()-interval '5 minutes' THEN 'stale' ELSE 'recent' END,
  'deletedCampaigns',health.deleted_campaigns,
  'overdueCampaigns',(SELECT count(*) FROM outreach.campaigns WHERE deletion_at<=now()),
  'failedCampaigns',(SELECT count(*) FROM outreach.retention_failures),
  'oldestDeadline',(SELECT min(deletion_at) FROM outreach.campaigns WHERE deletion_at<=now()),
  'selected',selected);
END $body$;

-- Reviewed source: 014_csv_import.sql, finalize_csv_import.
CREATE OR REPLACE FUNCTION outreach.finalize_csv_import(p_campaign uuid, p_digest text, p_rows jsonb, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE
  fields constant text[] := ARRAY['VANID','First Name','Last Name','Residence Address','Zip','Ward','Block','Lot','Qual','Property Location','Unit (verified)','Tier','Household Key'];
  item jsonb;
  entry record;
  counts jsonb;
  payload_hash text;
  saved outreach.imports%ROWTYPE;
  grouping text;
  building uuid;
  household uuid;
  person uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN
    RAISE EXCEPTION USING ERRCODE='JC001',MESSAGE='Import stage unavailable';
  END IF;
  IF p_campaign IS NULL OR p_actor IS NULL OR p_digest IS NULL OR p_digest !~ '^[a-f0-9]{64}$'
     OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR octet_length(p_rows::text)>16777216 THEN
    RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid import';
  END IF;
  IF jsonb_array_length(p_rows)<1 OR jsonb_array_length(p_rows)>10000 THEN
    RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid import size';
  END IF;

  -- Entire population/schema validation happens before the first resident write.
  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid source row';
    END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(item))<>cardinality(fields)
       OR NOT item ?& fields THEN
      RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid source fields';
    END IF;
    FOR entry IN SELECT key,value FROM jsonb_each(item) LOOP
      IF jsonb_typeof(entry.value) IS DISTINCT FROM 'string'
        OR length(item->>entry.key)>1000
        OR (item->>entry.key) ~ '[[:cntrl:]]'
        OR (item->>entry.key) IS DISTINCT FROM btrim(item->>entry.key)
        OR (entry.key NOT IN ('Qual','Unit (verified)') AND length(item->>entry.key)=0) THEN
        RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid source value';
      END IF;
    END LOOP;
    IF item->>'Tier' NOT IN ('1','2') OR item->>'Zip' !~ '^[0-9]{5}$'
       OR item->>'Ward' !~ '^[A-F]$'
       OR item->>'Household Key' IS DISTINCT FROM concat(item->>'Block','-',item->>'Lot','-',item->>'Qual')
       OR (item->>'Unit (verified)'='' AND (item->>'Residence Address') ~* '(\m(APT|APARTMENT|UNIT|SUITE|STE)\s+\S|#\s*\S)') THEN
      RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Invalid tier or household';
    END IF;
  END LOOP;

  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'VANID' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'Household Key'
      HAVING count(DISTINCT upper(regexp_replace(btrim(r->>'Residence Address'),'\s+',' ','g')))>1
      OR count(DISTINCT upper(regexp_replace(btrim(r->>'Unit (verified)'),'\s+',' ','g')))>1
      OR count(DISTINCT jsonb_build_array(upper(regexp_replace(btrim(r->>'Property Location'),'\s+',' ','g')),r->>'Zip'))>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r
      GROUP BY upper(regexp_replace(btrim(r->>'Property Location'),'\s+',' ','g')),r->>'Zip',upper(regexp_replace(btrim(r->>'Unit (verified)'),'\s+',' ','g'))
      HAVING count(DISTINCT r->>'Household Key')>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r
      GROUP BY upper(regexp_replace(btrim(r->>'Property Location'),'\s+',' ','g')),r->>'Zip'
      HAVING count(DISTINCT r->>'Ward')>1 OR (count(DISTINCT r->>'Household Key')>1 AND bool_or(r->>'Unit (verified)'=''))) THEN
    RAISE EXCEPTION USING ERRCODE='JC002',MESSAGE='Conflicting source grouping';
  END IF;

  SELECT jsonb_build_object('people',count(*),'households',count(DISTINCT r->>'Household Key'),
    'buildings',count(DISTINCT jsonb_build_array(upper(regexp_replace(btrim(r->>'Property Location'),'\s+',' ','g')),r->>'Zip')))
    INTO counts FROM jsonb_array_elements(p_rows) r;
  payload_hash := encode(sha256(convert_to(p_rows::text,'UTF8')),'hex');
  -- Same campaign lock as the immutable legacy fixture finalizer.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign::text,73401831));
  IF NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=p_campaign AND deletion_at>now() AND end_at IS NOT NULL AND created_by IS NOT NULL AND EXISTS(SELECT 1 FROM outreach.deployment d WHERE d.singleton AND ((d.stage='synthetic-preview' AND data_kind='synthetic') OR (d.stage='outreach-live' AND data_kind='live')))) THEN
    RAISE EXCEPTION USING ERRCODE='JC001',MESSAGE='Campaign unavailable';
  END IF;
  SELECT * INTO saved FROM outreach.imports WHERE campaign_id=p_campaign;
  IF FOUND THEN
    IF saved.source_digest IS DISTINCT FROM p_digest OR saved.payload_digest IS DISTINCT FROM payload_hash OR saved.finalized_by IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION USING ERRCODE='JC003',MESSAGE='Finalized import conflict';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM outreach.households WHERE campaign_id=p_campaign)
       OR EXISTS(SELECT 1 FROM outreach.assignments WHERE campaign_id=p_campaign) THEN
      RAISE EXCEPTION USING ERRCODE='JC003',MESSAGE='Import requires an empty campaign';
    END IF;
    INSERT INTO outreach.imports(campaign_id,id,source_digest,counts,finalized_by,payload_digest)
      VALUES(p_campaign,gen_random_uuid(),p_digest,counts,p_actor,payload_hash) RETURNING * INTO saved;
    FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
      grouping := jsonb_build_array(upper(regexp_replace(btrim(item->>'Property Location'),'\s+',' ','g')),item->>'Zip')::text;
      SELECT id INTO building FROM outreach.buildings WHERE campaign_id=p_campaign AND grouping_key=grouping;
      IF NOT FOUND THEN
        building := gen_random_uuid();
        INSERT INTO outreach.buildings(id,campaign_id,grouping_key,address,zip,ward)
          VALUES(building,p_campaign,grouping,item->>'Property Location',item->>'Zip',item->>'Ward');
      END IF;
      SELECT id INTO household FROM outreach.households WHERE campaign_id=p_campaign AND source_key=item->>'Household Key';
      IF NOT FOUND THEN
        household := gen_random_uuid();
        INSERT INTO outreach.households(id,campaign_id,building_id,address,unit,source_key)
          VALUES(household,p_campaign,building,item->>'Property Location',item->>'Unit (verified)',item->>'Household Key');
      END IF;
      person := gen_random_uuid();
      INSERT INTO outreach.people(id,household_id,first_name,last_name) VALUES(person,household,item->>'First Name',item->>'Last Name');
      INSERT INTO outreach.import_people(person_id,campaign_id,source_id,residence_address,zip,ward,block,lot,qual,property_location,verified_unit,tier,household_key)
        VALUES(person,p_campaign,item->>'VANID',item->>'Residence Address',item->>'Zip',item->>'Ward',item->>'Block',item->>'Lot',item->>'Qual',item->>'Property Location',item->>'Unit (verified)',item->>'Tier',item->>'Household Key');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('importId',saved.id,'campaignId',saved.campaign_id,'counts',saved.counts,'finalizedAt',saved.finalized_at);
END $body$;

-- Raw-file HTTP ingress is still closed. This exact capability is for the
-- authenticated, reviewed local preload service; never a direct table grant.
GRANT EXECUTE ON FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) TO jco_admin_reader;
