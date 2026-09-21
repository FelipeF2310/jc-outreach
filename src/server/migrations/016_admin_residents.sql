-- Read-only administrator projection; no resident, assignment, credential,
-- visit, password, deployment-stage or retention changes.
-- The application role retains bounded function access only. The NOLOGIN
-- assignment executor receives only the two additional columns it needs.
GRANT SELECT(first_name,last_name) ON outreach.people TO jco_assignment_executor;

CREATE OR REPLACE FUNCTION outreach.assignment_workspace(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $body$
DECLARE campaign outreach.campaigns%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage IN ('synthetic-preview','outreach-live')) THEN
    RAISE EXCEPTION USING ERRCODE='JA004',MESSAGE='Reviewed deployment required';
  END IF;
  SELECT * INTO campaign FROM outreach.campaigns
    WHERE id=p_campaign AND end_at IS NOT NULL AND deletion_at>statement_timestamp();
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM outreach.imports WHERE campaign_id=p_campaign) THEN
    RAISE EXCEPTION USING ERRCODE='JA001',MESSAGE='Imported campaign unavailable or expired';
  END IF;
  RETURN jsonb_build_object(
    'reassignmentReady',true,'campaignId',campaign.id,'endAt',campaign.end_at,'deletionAt',campaign.deletion_at,
    'households',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id',h.id,'sourceKey',h.source_key,'buildingId',h.building_id,
        'address',h.address,'unit',h.unit,'ward',b.ward,'suppressed',h.suppressed,
        'peopleCount',(SELECT count(*) FROM outreach.people p WHERE p.household_id=h.id),
        'people',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'firstName',p.first_name,'lastName',p.last_name
        ) ORDER BY p.last_name,p.first_name) FROM outreach.people p WHERE p.household_id=h.id),'[]'::jsonb)
      ) ORDER BY h.address,h.unit,h.id)
      FROM outreach.households h JOIN outreach.buildings b ON b.id=h.building_id AND b.campaign_id=h.campaign_id
      WHERE h.campaign_id=p_campaign
    ),'[]'::jsonb),
    'events',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'endsAt',e.ends_at) ORDER BY e.ends_at,e.id) FROM outreach.events e WHERE e.campaign_id=p_campaign),'[]'::jsonb),
    'assignments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'eventId',a.event_id,'name',a.name,'kind',a.kind,'supersededHouseholdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='superseded'),'householdIds',(SELECT coalesce(jsonb_agg(m.household_id ORDER BY m.position),'[]'::jsonb) FROM outreach.memberships m WHERE m.assignment_id=a.id AND m.state='active')) ORDER BY a.name,a.id) FROM outreach.assignments a WHERE a.campaign_id=p_campaign AND a.event_id IS NOT NULL),'[]'::jsonb)
  );
END $body$;
-- CREATE OR REPLACE preserves the existing private owner and ACL. Reassert
-- client denial without adding a new runtime capability or table grant.
REVOKE ALL ON FUNCTION outreach.assignment_workspace(uuid) FROM PUBLIC;
DO $acl$ DECLARE item record; BEGIN
  FOR item IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION outreach.assignment_workspace(uuid) FROM %I',item.rolname);
  END LOOP;
END $acl$;
