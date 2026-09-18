-- Shared demo/hosted completion data. No visit or assignment is marked attempted.
CREATE TABLE outreach.completion_reports (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES outreach.campaigns ON DELETE CASCADE,
 assignment_id uuid NOT NULL REFERENCES outreach.assignments ON DELETE CASCADE,
 token_hash text NOT NULL REFERENCES outreach.credentials ON DELETE CASCADE,
 device_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('working','finished')),
 operation_ids uuid[] NOT NULL, pending_ids uuid[] NOT NULL, payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(assignment_id,device_id,version)
);
ALTER TABLE outreach.completion_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON outreach.completion_reports FROM PUBLIC;

-- Internal invoker helper: callers must authorize/lock the assignment first.
CREATE FUNCTION outreach.record_completion(p_assignment uuid,p_campaign uuid,p_hash text,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $body$
DECLARE prior outreach.completion_reports%ROWTYPE; latest outreach.completion_reports%ROWTYPE;
 oid uuid; device uuid; v integer; ids uuid[]; pending uuid[]; received timestamptz;
BEGIN
 IF p IS NULL OR octet_length(p::text)>180000 THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid report'; END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& ARRAY['id','assignmentId','deviceId','version','state','operationIds','pendingIds','createdAt'] OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE NOT k=ANY(ARRAY['id','assignmentId','deviceId','version','state','operationIds','pendingIds','createdAt'])) THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid report'; END IF;
 IF jsonb_typeof(p->'version') IS DISTINCT FROM 'number' OR (p->>'version') !~ '^[1-9][0-9]{0,8}$' OR NOT coalesce(p->>'state' IN ('working','finished'),false) OR jsonb_typeof(p->'operationIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'pendingIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'createdAt') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid report'; END IF;
 IF jsonb_array_length(p->'operationIds')>2000 OR jsonb_array_length(p->'pendingIds')>2000 THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Report too large'; END IF;
 oid:=(p->>'id')::uuid; device:=(p->>'deviceId')::uuid; v:=(p->>'version')::integer;
 IF oid IS NULL OR device IS NULL OR (p->>'assignmentId')::uuid IS DISTINCT FROM p_assignment OR (p->>'createdAt')::timestamptz IS NULL OR NOT isfinite((p->>'createdAt')::timestamptz) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Report scope mismatch'; END IF;
 ids:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'operationIds'));
 pending:=ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(p->'pendingIds'));
 IF array_position(ids,NULL) IS NOT NULL OR array_position(pending,NULL) IS NOT NULL OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) OR cardinality(pending)<>(SELECT count(DISTINCT x) FROM unnest(pending) x) OR NOT pending<@ids THEN RAISE EXCEPTION USING ERRCODE='JF422',MESSAGE='Invalid operation manifest'; END IF;
 IF EXISTS(SELECT 1 FROM outreach.operations WHERE id=ANY(ids) AND assignment_id<>p_assignment) THEN RAISE EXCEPTION USING ERRCODE='JF403',MESSAGE='Operation outside assignment'; END IF;
 SELECT * INTO prior FROM outreach.completion_reports WHERE id=oid;
 IF FOUND THEN
   IF prior.assignment_id<>p_assignment OR prior.token_hash<>p_hash OR prior.payload<>p THEN RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Report ID conflict'; END IF;
   RETURN jsonb_build_object('reportId',prior.id,'receivedAt',prior.received_at);
 END IF;
 SELECT * INTO latest FROM outreach.completion_reports WHERE assignment_id=p_assignment AND device_id=device ORDER BY version DESC LIMIT 1;
 IF FOUND AND (latest.version=v OR (v>latest.version AND NOT latest.operation_ids<@ids)) THEN RAISE EXCEPTION USING ERRCODE='JF409',MESSAGE='Report history conflict'; END IF;
 INSERT INTO outreach.completion_reports(id,campaign_id,assignment_id,token_hash,device_id,version,state,operation_ids,pending_ids,payload)
 VALUES(oid,p_campaign,p_assignment,p_hash,device,v,p->>'state',ids,pending,p) RETURNING received_at INTO received;
 RETURN jsonb_build_object('reportId',oid,'receivedAt',received);
END $body$;

CREATE FUNCTION outreach.completion_snapshot(p_assignment uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $body$
 SELECT jsonb_build_object('completionReady',true,'devices',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'deviceId',r.device_id,'label',to_jsonb(k)->>'label','state',r.state,'version',r.version,'receivedAt',r.received_at,
 'declaredCount',cardinality(r.operation_ids),'pendingReportedCount',cardinality(r.pending_ids),
 'missingCount',(SELECT count(*) FROM unnest(r.operation_ids) i WHERE NOT EXISTS(SELECT 1 FROM outreach.operations o WHERE o.id=i AND o.assignment_id=p_assignment)),
 'additionalActivity',EXISTS(SELECT 1 FROM outreach.operations o WHERE o.assignment_id=p_assignment AND o.received_at>r.received_at AND NOT EXISTS(SELECT 1 FROM outreach.completion_reports known WHERE known.assignment_id=p_assignment AND o.id=ANY(known.operation_ids)))
 ) ORDER BY r.device_id) FROM (SELECT DISTINCT ON(device_id) * FROM outreach.completion_reports WHERE assignment_id=p_assignment ORDER BY device_id,version DESC) r JOIN outreach.credentials k ON k.token_hash=r.token_hash),'[]'::jsonb));
$body$;
REVOKE ALL ON FUNCTION outreach.record_completion(uuid,uuid,text,jsonb),outreach.completion_snapshot(uuid) FROM PUBLIC;
