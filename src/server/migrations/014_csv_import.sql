-- General CSV persistence engine. Intentionally NO runtime EXECUTE grant yet.
-- The owner may rehearse in an isolated synthetic database. Enabling resident
-- ingress/stage/authority requires the separate reviewed launch operation.
ALTER TABLE outreach.imports ADD COLUMN payload_digest text
  CHECK(payload_digest IS NULL OR payload_digest ~ '^[a-f0-9]{64}$');

CREATE FUNCTION outreach.finalize_csv_import(p_campaign uuid, p_digest text, p_rows jsonb, p_actor uuid)
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
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN
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
  IF NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=p_campaign AND deletion_at>now() AND end_at IS NOT NULL AND created_by IS NOT NULL) THEN
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
REVOKE ALL ON FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','jco_admin_reader') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) FROM %I',item.rolname);
  END LOOP;
END $acl$;
GRANT CREATE ON SCHEMA outreach TO jco_import_executor;
ALTER FUNCTION outreach.finalize_csv_import(uuid,text,jsonb,uuid) OWNER TO jco_import_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_import_executor;
-- Deliberately no GRANT EXECUTE to runtime. No new HTTP route is registered.
