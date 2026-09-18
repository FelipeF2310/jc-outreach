-- Synthetic hosted field access. No credentials or field records are created here.
ALTER TABLE outreach.credentials ADD COLUMN id uuid UNIQUE;
ALTER TABLE outreach.credentials ADD COLUMN created_by uuid;
ALTER TABLE outreach.credentials ADD COLUMN issued_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outreach.credentials ADD COLUMN revoked_at timestamptz;
ALTER TABLE outreach.credentials ADD COLUMN revoked_by uuid;

CREATE ROLE jco_field_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE jco_field_admin_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $roles$ BEGIN
  EXECUTE format('GRANT jco_field_executor,jco_field_admin_executor TO %I',current_user);
END $roles$;
GRANT USAGE,CREATE ON SCHEMA outreach TO jco_field_executor,jco_field_admin_executor;
GRANT SELECT ON outreach.deployment,outreach.campaigns,outreach.events,outreach.assignments,outreach.memberships,outreach.credentials,outreach.households,outreach.people,outreach.operations,outreach.visits TO jco_field_executor;
GRANT INSERT ON outreach.operations,outreach.visits,outreach.help_requests,outreach.corrections,outreach.building_attempts TO jco_field_executor;
GRANT UPDATE(result,latest_operation_id) ON outreach.visits TO jco_field_executor;
GRANT UPDATE(suppressed) ON outreach.households TO jco_field_executor;
GRANT SELECT ON outreach.deployment,outreach.campaigns,outreach.events,outreach.assignments,outreach.memberships,outreach.credentials,outreach.households,outreach.operations,outreach.visits,outreach.help_requests,outreach.building_attempts TO jco_field_admin_executor;
GRANT INSERT ON outreach.credentials TO jco_field_admin_executor;
GRANT UPDATE(revoked,revoked_at,revoked_by) ON outreach.credentials TO jco_field_admin_executor;
-- These NOLOGIN roles are reachable only through the exact functions below.
-- Functions validate the credential/action and scope every resident query.
DO $policies$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['deployment','campaigns','events','assignments','memberships','credentials','households','people','operations','visits'] LOOP
    EXECUTE format('CREATE POLICY field_read ON outreach.%I FOR SELECT TO jco_field_executor USING(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['operations','visits','help_requests','corrections','building_attempts'] LOOP
    EXECUTE format('CREATE POLICY field_insert ON outreach.%I FOR INSERT TO jco_field_executor WITH CHECK(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['households','visits'] LOOP
    EXECUTE format('CREATE POLICY field_update ON outreach.%I FOR UPDATE TO jco_field_executor USING(true) WITH CHECK(true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['deployment','campaigns','events','assignments','memberships','credentials','households','operations','visits','help_requests','building_attempts'] LOOP
    EXECUTE format('CREATE POLICY field_admin_read ON outreach.%I FOR SELECT TO jco_field_admin_executor USING(true)',t);
  END LOOP;
END $policies$;
CREATE POLICY field_admin_insert ON outreach.credentials FOR INSERT TO jco_field_admin_executor WITH CHECK(true);
CREATE POLICY field_admin_update ON outreach.credentials FOR UPDATE TO jco_field_admin_executor USING(true) WITH CHECK(true);

-- Internal helper, never granted to the runtime. Recheck after the assignment lock
-- so revoke and submit/download have an unambiguous transaction ordering.
CREATE FUNCTION outreach.field_access(p_hash text,p_write boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE aid uuid; a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Synthetic stage required'; END IF;
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

CREATE FUNCTION outreach.download_field_assignment(p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb;
BEGIN
  a:=outreach.field_access(p_hash,false);
  RETURN a||jsonb_build_object('synthetic',true,'households',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',h.id,'buildingId',h.building_id,'address',h.address,'unit',h.unit,'suppressed',h.suppressed,
      'people',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'firstName',p.first_name,'lastName',p.last_name) ORDER BY p.first_name,p.id),'[]'::jsonb) FROM outreach.people p WHERE p.household_id=h.id)) ORDER BY m.position)
    FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id
    WHERE m.assignment_id=(a->>'id')::uuid AND m.state='active' AND h.campaign_id=(a->>'campaignId')::uuid
  ),'[]'::jsonb));
END $body$;

-- SQL validation is defense in depth behind the shared strict application schema.
CREATE FUNCTION outreach.field_keys(p jsonb,keys text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $body$
  SELECT CASE WHEN jsonb_typeof(p)='object' THEN p ?& keys AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT k=ANY(keys)) ELSE false END
$body$;

CREATE FUNCTION outreach.submit_field_operation(p_hash text,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb; aid uuid; cid uuid; oid uuid; hid uuid; vid uuid; created timestamptz; received timestamptz;
  prior outreach.operations%ROWTYPE; latest uuid; item jsonb; person uuid; kind text; keys text[];
BEGIN
  a:=outreach.field_access(p_hash,true); aid:=(a->>'id')::uuid; cid:=(a->>'campaignId')::uuid;
  IF p IS NULL OR octet_length(p::text)>16384 OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid operation'; END IF;
  kind:=p->>'kind';
  keys:=ARRAY['id','assignmentId','createdAt','schemaVersion','kind'];
  IF kind='visit' THEN keys:=keys||ARRAY['visitId','householdId','result','programs','help','corrections','doNotContact'];
  ELSIF kind='revision' THEN keys:=keys||ARRAY['visitId','householdId','originalOperationId','previousOperationId','result'];
  ELSIF kind='building' THEN keys:=keys||ARRAY['buildingId','reason'];
  ELSE RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid kind'; END IF;
  IF NOT outreach.field_keys(p,keys) OR p->'schemaVersion'<>'1'::jsonb OR jsonb_typeof(p->'createdAt')<>'string' THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid fields'; END IF;
  oid:=(p->>'id')::uuid; created:=(p->>'createdAt')::timestamptz;
  IF oid IS NULL OR created IS NULL OR NOT isfinite(created) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid identity or time'; END IF;
  IF (p->>'assignmentId')::uuid IS DISTINCT FROM aid THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Outside assignment'; END IF;
  -- A global operation-ID lock also makes a collision across two assignments safe.
  PERFORM pg_advisory_xact_lock(hashtextextended(oid::text,73401835));
  SELECT * INTO prior FROM outreach.operations WHERE id=oid;
  IF FOUND THEN
    IF prior.assignment_id<>aid OR prior.payload<>p THEN RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Operation conflict'; END IF;
    RETURN jsonb_build_object('operationId',oid,'receivedAt',prior.received_at);
  END IF;
  IF created>=(a->>'eventEndsAt')::timestamptz THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='New work after event end'; END IF;
  IF kind='building' THEN
    IF NOT coalesce(p->>'reason'=ANY(ARRAY['locked','security','entrance','other']),false) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid access reason'; END IF;
    IF NOT EXISTS(SELECT 1 FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id WHERE m.assignment_id=aid AND h.campaign_id=cid AND h.building_id=(p->>'buildingId')::uuid) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Outside building'; END IF;
  ELSE
    hid:=(p->>'householdId')::uuid; vid:=(p->>'visitId')::uuid;
    IF vid IS NULL OR NOT coalesce(p->>'result'=ANY(ARRAY['resident','other','no_answer','inaccessible','declined']),false) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid visit'; END IF;
    -- Superseded memberships remain authorized to upload genuine pending work.
    IF NOT EXISTS(SELECT 1 FROM outreach.memberships m JOIN outreach.households h ON h.id=m.household_id WHERE m.assignment_id=aid AND h.id=hid AND h.campaign_id=cid) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Outside household'; END IF;
  END IF;
  IF kind='visit' THEN
    IF jsonb_typeof(p->'programs')<>'array' OR jsonb_typeof(p->'corrections')<>'array' OR jsonb_typeof(p->'doNotContact')<>'boolean' THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid visit details'; END IF;
    IF jsonb_array_length(p->'programs')>3 OR jsonb_array_length(p->'corrections')>8 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'programs') v WHERE NOT coalesce(v=ANY(ARRAY['freeze','stay','anchor']),false)) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid visit details'; END IF;
    IF p->'help'<>'null'::jsonb THEN
      item:=p->'help';
      IF NOT outreach.field_keys(item,ARRAY['id','personId','phone','consent','arrangement']) OR (item->>'id')::uuid IS NULL OR jsonb_typeof(item->'phone')<>'string' OR length(item->>'phone')>32 OR jsonb_typeof(item->'consent')<>'boolean' OR NOT coalesce(item->>'arrangement'=ANY(ARRAY['return','referral','unspecified']),false) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid help request'; END IF;
      IF btrim(item->>'phone')<>'' AND item->'consent'<>'true'::jsonb THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Phone permission required'; END IF;
      person:=(item->>'personId')::uuid;
      IF person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outreach.people WHERE id=person AND household_id=hid) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Outside person'; END IF;
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p->'corrections') LOOP
      IF NOT outreach.field_keys(item,ARRAY['id','personId','kind']) OR (item->>'id')::uuid IS NULL OR NOT coalesce(item->>'kind'=ANY(ARRAY['rents','moved','deceased','address']),false) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid correction'; END IF;
      person:=(item->>'personId')::uuid;
      IF person IS NULL AND item->>'kind' IN ('moved','deceased') THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Person required'; END IF;
      IF person IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outreach.people WHERE id=person AND household_id=hid) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Outside person'; END IF;
    END LOOP;
  ELSIF kind='revision' THEN
    SELECT v.latest_operation_id INTO latest FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id
      WHERE v.id=vid AND v.household_id=hid AND v.operation_id=(p->>'originalOperationId')::uuid AND o.assignment_id=aid;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF424',MESSAGE='Original operation required'; END IF;
    IF latest IS DISTINCT FROM (p->>'previousOperationId')::uuid THEN RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Revision conflict'; END IF;
  END IF;
  INSERT INTO outreach.operations(id,assignment_id,payload) VALUES(oid,aid,p) RETURNING received_at INTO received;
  IF kind='building' THEN
    INSERT INTO outreach.building_attempts(operation_id,building_id,reason) VALUES(oid,(p->>'buildingId')::uuid,p->>'reason');
  ELSIF kind='revision' THEN
    UPDATE outreach.visits SET result=p->>'result',latest_operation_id=oid WHERE id=vid;
  ELSE
    INSERT INTO outreach.visits(id,household_id,operation_id,latest_operation_id,result) VALUES(vid,hid,oid,oid,p->>'result');
    IF p->'help'<>'null'::jsonb THEN
      item:=p->'help';
      INSERT INTO outreach.help_requests(id,visit_id,person_id,phone,consent,arrangement) VALUES((item->>'id')::uuid,vid,(item->>'personId')::uuid,item->>'phone',(item->>'consent')::boolean,item->>'arrangement');
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p->'corrections') LOOP
      INSERT INTO outreach.corrections(id,visit_id,person_id,kind) VALUES((item->>'id')::uuid,vid,(item->>'personId')::uuid,item->>'kind');
    END LOOP;
    IF (p->>'doNotContact')::boolean THEN UPDATE outreach.households SET suppressed=true WHERE id=hid AND campaign_id=cid; END IF;
  END IF;
  RETURN jsonb_build_object('operationId',oid,'receivedAt',received);
END $body$;

CREATE FUNCTION outreach.field_admin_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a record;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN RAISE EXCEPTION USING ERRCODE='JF503',MESSAGE='Synthetic stage required'; END IF;
  SELECT s.id,e.ends_at,c.deletion_at INTO a FROM outreach.assignments s JOIN outreach.events e ON e.id=s.event_id AND e.campaign_id=s.campaign_id JOIN outreach.campaigns c ON c.id=s.campaign_id WHERE s.id=p_assignment AND c.deletion_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='JF404',MESSAGE='Assignment unavailable'; END IF;
  RETURN jsonb_build_object('assignmentId',a.id,'eventEndsAt',a.ends_at,'uploadEndsAt',least(a.ends_at+interval '72 hours',a.deletion_at),'deletionAt',a.deletion_at,
    'credentials',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'issuedAt',issued_at,'revoked',revoked,'revokedAt',revoked_at) ORDER BY issued_at,id) FROM outreach.credentials WHERE assignment_id=a.id AND id IS NOT NULL),'[]'::jsonb),
    'visits',coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'address',h.address,'unit',h.unit,'result',v.result,'receivedAt',o.received_at) ORDER BY o.received_at DESC,v.id) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id JOIN outreach.households h ON h.id=v.household_id WHERE o.assignment_id=a.id),'[]'::jsonb),
    'counts',(SELECT jsonb_build_object('attempts',count(DISTINCT v.household_id),'repeats',count(*)-count(DISTINCT v.household_id),'conversations',count(*) FILTER(WHERE v.result IN ('resident','other'))) FROM outreach.visits v JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'buildingFailures',(SELECT count(*) FROM outreach.building_attempts b JOIN outreach.operations o ON o.id=b.operation_id WHERE o.assignment_id=a.id),
    'helpRequests',(SELECT count(*) FROM outreach.help_requests h JOIN outreach.visits v ON v.id=h.visit_id JOIN outreach.operations o ON o.id=v.operation_id WHERE o.assignment_id=a.id),
    'latestReceivedAt',(SELECT max(received_at) FROM outreach.operations WHERE assignment_id=a.id));
END $body$;

CREATE FUNCTION outreach.issue_field_credential(p_id uuid,p_assignment uuid,p_hash text,p_actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
DECLARE a jsonb; old outreach.credentials%ROWTYPE;
BEGIN
  a:=outreach.field_admin_snapshot(p_assignment);
  IF p_id IS NULL OR p_actor IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid credential'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_assignment::text,73401834));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,73401836));
  SELECT * INTO old FROM outreach.credentials WHERE id=p_id;
  IF FOUND THEN
    IF old.assignment_id<>p_assignment OR old.created_by IS DISTINCT FROM p_actor THEN RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Credential ID conflict'; END IF;
    RETURN false; -- Same issuance request, no new secret. Never persist a recoverable raw token.
  END IF;
  IF (a->>'eventEndsAt')::timestamptz<=clock_timestamp() OR (a->>'deletionAt')::timestamptz<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM outreach.memberships WHERE assignment_id=p_assignment AND state='active') THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Active assignment required'; END IF;
  INSERT INTO outreach.credentials(id,token_hash,assignment_id,created_by) VALUES(p_id,p_hash,p_assignment,p_actor);
  RETURN true;
END $body$;

CREATE FUNCTION outreach.revoke_field_credential(p_id uuid,p_assignment uuid,p_actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $body$
BEGIN
  PERFORM outreach.field_admin_snapshot(p_assignment);
  IF p_actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Actor required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_assignment::text,73401834));
  IF NOT EXISTS(SELECT 1 FROM outreach.credentials WHERE id=p_id AND assignment_id=p_assignment) THEN RAISE EXCEPTION USING ERRCODE='JF404',MESSAGE='Credential unavailable'; END IF;
  UPDATE outreach.credentials SET revoked=true,revoked_at=coalesce(revoked_at,clock_timestamp()),revoked_by=coalesce(revoked_by,p_actor) WHERE id=p_id AND assignment_id=p_assignment;
END $body$;

REVOKE ALL ON FUNCTION outreach.field_access(text,boolean),outreach.field_keys(jsonb,text[]),outreach.download_field_assignment(text),outreach.submit_field_operation(text,jsonb),outreach.field_admin_snapshot(uuid),outreach.issue_field_credential(uuid,uuid,text,uuid),outreach.revoke_field_credential(uuid,uuid,uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.field_access(text,boolean),outreach.field_keys(jsonb,text[]),outreach.download_field_assignment(text),outreach.submit_field_operation(text,jsonb),outreach.field_admin_snapshot(uuid),outreach.issue_field_credential(uuid,uuid,text,uuid),outreach.revoke_field_credential(uuid,uuid,uuid) FROM %I',r.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.field_access(text,boolean) OWNER TO jco_field_executor;
ALTER FUNCTION outreach.field_keys(jsonb,text[]) OWNER TO jco_field_executor;
ALTER FUNCTION outreach.download_field_assignment(text) OWNER TO jco_field_executor;
ALTER FUNCTION outreach.submit_field_operation(text,jsonb) OWNER TO jco_field_executor;
ALTER FUNCTION outreach.field_admin_snapshot(uuid) OWNER TO jco_field_admin_executor;
ALTER FUNCTION outreach.issue_field_credential(uuid,uuid,text,uuid) OWNER TO jco_field_admin_executor;
ALTER FUNCTION outreach.revoke_field_credential(uuid,uuid,uuid) OWNER TO jco_field_admin_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_field_executor,jco_field_admin_executor;
GRANT EXECUTE ON FUNCTION outreach.download_field_assignment(text),outreach.submit_field_operation(text,jsonb),outreach.field_admin_snapshot(uuid),outreach.issue_field_credential(uuid,uuid,text,uuid),outreach.revoke_field_credential(uuid,uuid,uuid) TO jco_admin_reader;
