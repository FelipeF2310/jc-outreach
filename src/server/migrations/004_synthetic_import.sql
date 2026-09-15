-- Additive hosted synthetic-only import capability. Never edit after application.
CREATE ROLE jco_import_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $membership$ BEGIN
  EXECUTE format('GRANT jco_import_executor TO %I', current_user);
END $membership$;
GRANT USAGE, CREATE ON SCHEMA outreach TO jco_import_executor;
ALTER TABLE outreach.imports ADD COLUMN finalized_by uuid;
GRANT SELECT ON outreach.deployment, outreach.campaigns, outreach.imports,
  outreach.buildings, outreach.households, outreach.assignments TO jco_import_executor;
GRANT INSERT ON outreach.imports, outreach.buildings, outreach.households,
  outreach.people, outreach.import_people TO jco_import_executor;
CREATE POLICY import_executor_stage ON outreach.deployment FOR SELECT TO jco_import_executor USING (true);
CREATE POLICY import_executor_campaigns ON outreach.campaigns FOR SELECT TO jco_import_executor USING (deletion_at > now());
DO $policies$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['imports','buildings','households','assignments'] LOOP
    EXECUTE format('CREATE POLICY import_executor_read ON outreach.%I FOR SELECT TO jco_import_executor USING (campaign_id IN (SELECT id FROM outreach.campaigns))', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['imports','buildings','households','import_people'] LOOP
    EXECUTE format('CREATE POLICY import_executor_insert ON outreach.%I FOR INSERT TO jco_import_executor WITH CHECK (campaign_id IN (SELECT id FROM outreach.campaigns))', table_name);
  END LOOP;
END $policies$;
CREATE POLICY import_executor_people ON outreach.people FOR INSERT TO jco_import_executor
  WITH CHECK (household_id IN (SELECT id FROM outreach.households));

-- No source rows/CSV/JSON argument: the database can import only these approved fixtures.
CREATE FUNCTION outreach.finalize_synthetic_import(p_campaign uuid, p_digest text, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  expected_digest constant text := '8ac68dd351b7737b3d341480a6e927eada801ee8324b01d614e4bb4f53e3b707';
  fixture_rows constant jsonb := $fixture$[{"VANID":"00000001","First Name":"Resident A","Last Name":"Fixture","Residence Address":"100 Fixture Walk Apt 2A","Zip":"07304","Ward":"D","Block":"00001","Lot":"01","Qual":"C0201","Property Location":"100 FIXTURE WALK","Unit (verified)":"2A","Tier":"1","Household Key":"00001-01-C0201","buildingKey":"[\"100 FIXTURE WALK\",\"07304\"]"},{"VANID":"00000002","First Name":"Resident B","Last Name":"Fixture","Residence Address":"100 Fixture Walk Apt 2A","Zip":"07304","Ward":"D","Block":"00001","Lot":"01","Qual":"C0201","Property Location":"100 FIXTURE WALK","Unit (verified)":"2A","Tier":"1","Household Key":"00001-01-C0201","buildingKey":"[\"100 FIXTURE WALK\",\"07304\"]"},{"VANID":"00000003","First Name":"Resident C","Last Name":"Fixture","Residence Address":"100 Fixture Walk Apt 10B","Zip":"07304","Ward":"D","Block":"00001","Lot":"01","Qual":"C1002","Property Location":"100 FIXTURE WALK","Unit (verified)":"10B","Tier":"2","Household Key":"00001-01-C1002","buildingKey":"[\"100 FIXTURE WALK\",\"07304\"]"},{"VANID":"00000004","First Name":"Resident D","Last Name":"Fixture","Residence Address":"200 Synthetic Lane","Zip":"07302","Ward":"E","Block":"00002","Lot":"02","Qual":"","Property Location":"200 SYNTHETIC LANE","Unit (verified)":"","Tier":"1","Household Key":"00002-02-","buildingKey":"[\"200 SYNTHETIC LANE\",\"07302\"]"}]$fixture$::jsonb;
  fixture_counts constant jsonb := '{"people":4,"households":3,"buildings":2}'::jsonb;
  item jsonb;
  saved outreach.imports%ROWTYPE;
  building uuid;
  household uuid;
  person uuid;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN
    RAISE EXCEPTION USING ERRCODE='JI004', MESSAGE='Synthetic deployment required';
  END IF;
  IF p_actor IS NULL OR p_digest IS DISTINCT FROM expected_digest THEN
    RAISE EXCEPTION USING ERRCODE='JI002', MESSAGE='Approved synthetic preview required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_campaign::text,73401831));
  IF NOT EXISTS(SELECT 1 FROM outreach.campaigns WHERE id=p_campaign AND end_at IS NOT NULL AND created_by IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='JI001', MESSAGE='Campaign unavailable or expired';
  END IF;
  SELECT * INTO saved FROM outreach.imports WHERE campaign_id=p_campaign;
  IF FOUND THEN
    IF saved.source_digest IS DISTINCT FROM expected_digest THEN
      RAISE EXCEPTION USING ERRCODE='JI003', MESSAGE='Finalized source cannot be replaced';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM outreach.households WHERE campaign_id=p_campaign)
      OR EXISTS(SELECT 1 FROM outreach.assignments WHERE campaign_id=p_campaign) THEN
      RAISE EXCEPTION USING ERRCODE='JI003', MESSAGE='Import requires an empty campaign';
    END IF;
    INSERT INTO outreach.imports(campaign_id,id,source_digest,counts,finalized_by)
      VALUES(p_campaign,gen_random_uuid(),expected_digest,fixture_counts,p_actor) RETURNING * INTO saved;
    FOR item IN SELECT value FROM jsonb_array_elements(fixture_rows) LOOP
      SELECT id INTO building FROM outreach.buildings
        WHERE campaign_id=p_campaign AND grouping_key=item->>'buildingKey';
      IF NOT FOUND THEN
        building := gen_random_uuid();
        INSERT INTO outreach.buildings(id,campaign_id,grouping_key,address,zip,ward)
          VALUES(building,p_campaign,item->>'buildingKey',item->>'Property Location',item->>'Zip',item->>'Ward');
      END IF;
      SELECT id INTO household FROM outreach.households
        WHERE campaign_id=p_campaign AND source_key=item->>'Household Key';
      IF NOT FOUND THEN
        household := gen_random_uuid();
        INSERT INTO outreach.households(id,campaign_id,building_id,address,unit,source_key)
          VALUES(household,p_campaign,building,item->>'Property Location',item->>'Unit (verified)',item->>'Household Key');
      END IF;
      person := gen_random_uuid();
      INSERT INTO outreach.people(id,household_id,first_name,last_name)
        VALUES(person,household,item->>'First Name',item->>'Last Name');
      INSERT INTO outreach.import_people(person_id,campaign_id,source_id,residence_address,zip,ward,block,lot,qual,property_location,verified_unit,tier,household_key)
        VALUES(person,p_campaign,item->>'VANID',item->>'Residence Address',item->>'Zip',item->>'Ward',
          item->>'Block',item->>'Lot',item->>'Qual',item->>'Property Location',item->>'Unit (verified)',item->>'Tier',item->>'Household Key');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('importId',saved.id,'campaignId',saved.campaign_id,
    'counts',saved.counts,'finalizedAt',saved.finalized_at);
END $body$;

-- Only receipt metadata, never source rows or resident names, is returned to the runtime.
CREATE FUNCTION outreach.synthetic_import_status()
RETURNS TABLE(campaign_id uuid, receipt jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $body$
  SELECT i.campaign_id, jsonb_build_object('importId',i.id,'campaignId',i.campaign_id,
    'counts',i.counts,'finalizedAt',i.finalized_at)
  FROM outreach.imports i JOIN outreach.campaigns c ON c.id=i.campaign_id
  WHERE c.deletion_at>now() AND EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview')
$body$;
REVOKE ALL ON FUNCTION outreach.finalize_synthetic_import(uuid,text,uuid), outreach.synthetic_import_status() FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.finalize_synthetic_import(uuid,text,uuid), outreach.synthetic_import_status() FROM %I', item.rolname);
  END LOOP;
END $acl$;
ALTER FUNCTION outreach.finalize_synthetic_import(uuid,text,uuid) OWNER TO jco_import_executor;
ALTER FUNCTION outreach.synthetic_import_status() OWNER TO jco_import_executor;
REVOKE CREATE ON SCHEMA outreach FROM jco_import_executor;
GRANT EXECUTE ON FUNCTION outreach.finalize_synthetic_import(uuid,text,uuid), outreach.synthetic_import_status() TO jco_admin_reader;

