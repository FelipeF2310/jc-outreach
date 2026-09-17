-- Installs the synthetic-only retention worker; does NOT schedule or run it.
-- Only the operator may execute the worker. Runtime receives a read-only summary.
CREATE ROLE jco_retention_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $membership$ BEGIN
 EXECUTE format('GRANT jco_retention_executor TO %I',current_user);
END $membership$;
GRANT USAGE,CREATE ON SCHEMA outreach TO jco_retention_executor;

CREATE TABLE outreach.retention_health (
 singleton boolean PRIMARY KEY CHECK(singleton),
 checked_at timestamptz,
 deleted_campaigns bigint NOT NULL DEFAULT 0 CHECK(deleted_campaigns >= 0)
);
INSERT INTO outreach.retention_health(singleton) VALUES(true);
CREATE TABLE outreach.retention_failures (
 campaign_id uuid PRIMARY KEY REFERENCES outreach.campaigns ON DELETE CASCADE,
 attempted_at timestamptz NOT NULL
);
ALTER TABLE outreach.retention_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach.retention_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach.retention_health,outreach.retention_failures FROM PUBLIC;
GRANT SELECT,UPDATE ON outreach.retention_health TO jco_retention_executor;
GRANT SELECT,INSERT,UPDATE ON outreach.retention_failures TO jco_retention_executor;
GRANT SELECT,DELETE ON outreach.campaigns TO jco_retention_executor;
GRANT SELECT ON outreach.deployment,outreach.households,outreach.visits,outreach.help_requests TO jco_retention_executor;
CREATE POLICY retention_health_access ON outreach.retention_health TO jco_retention_executor USING(true) WITH CHECK(true);
CREATE POLICY retention_failure_access ON outreach.retention_failures TO jco_retention_executor USING(true) WITH CHECK(true);
CREATE POLICY retention_campaign_read ON outreach.campaigns FOR SELECT TO jco_retention_executor USING(true);
CREATE POLICY retention_campaign_delete ON outreach.campaigns FOR DELETE TO jco_retention_executor USING(deletion_at <= clock_timestamp());
CREATE POLICY retention_stage ON outreach.deployment FOR SELECT TO jco_retention_executor USING(true);
CREATE POLICY retention_households ON outreach.households FOR SELECT TO jco_retention_executor USING(true);
CREATE POLICY retention_visits ON outreach.visits FOR SELECT TO jco_retention_executor USING(true);
CREATE POLICY retention_help ON outreach.help_requests FOR SELECT TO jco_retention_executor USING(true);

CREATE FUNCTION outreach.run_retention()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET lock_timeout='2s' AS $body$
DECLARE item record; removed uuid; deleted_count integer:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN
  RAISE EXCEPTION USING ERRCODE='JR503',MESSAGE='Synthetic deployment required';
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

CREATE FUNCTION outreach.retention_status(p_campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $body$
DECLARE health outreach.retention_health%ROWTYPE; selected jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM outreach.deployment WHERE singleton AND stage='synthetic-preview') THEN
  RAISE EXCEPTION USING ERRCODE='JR503',MESSAGE='Synthetic deployment required';
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
REVOKE ALL ON FUNCTION outreach.run_retention(),outreach.retention_status(uuid) FROM PUBLIC;
DO $acl$ DECLARE r record; BEGIN
 FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN('anon','authenticated','service_role') LOOP
  EXECUTE format('REVOKE ALL ON outreach.retention_health,outreach.retention_failures FROM %I',r.rolname);
  EXECUTE format('REVOKE ALL ON FUNCTION outreach.run_retention(),outreach.retention_status(uuid) FROM %I',r.rolname);
 END LOOP;
END $acl$;
ALTER FUNCTION outreach.run_retention() OWNER TO jco_retention_executor;
ALTER FUNCTION outreach.retention_status(uuid) OWNER TO jco_retention_executor;
GRANT EXECUTE ON FUNCTION outreach.retention_status(uuid) TO jco_admin_reader;
REVOKE CREATE ON SCHEMA outreach FROM jco_retention_executor;
