BEGIN;
INSERT INTO permissions(code,description) VALUES('numbering:view','Inspect document formats and change requests'),('numbering:propose','Propose unused document numbering formats'),('numbering:approve','Independently review document numbering formats') ON CONFLICT DO NOTHING;
CREATE TABLE document_numbering_policies(
 id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL, document_type text NOT NULL REFERENCES document_numbering_defaults(document_type), calendar_year integer NOT NULL CHECK(calendar_year BETWEEN 1 AND 9999),
 prefix text NOT NULL CHECK(length(prefix) BETWEEN 2 AND 16 AND prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'), padding integer NOT NULL CHECK(padding BETWEEN 4 AND 12), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id), updated_at timestamptz, last_request_id uuid NOT NULL,
 UNIQUE(company_id,id), UNIQUE(company_id,branch_id,document_type,calendar_year), UNIQUE(company_id,branch_id,calendar_year,prefix), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id)
);
CREATE TABLE numbering_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL, document_type text NOT NULL REFERENCES document_numbering_defaults(document_type), calendar_year integer NOT NULL CHECK(calendar_year BETWEEN 1 AND 9999),
 prefix text NOT NULL CHECK(length(prefix) BETWEEN 2 AND 16 AND prefix ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'), padding integer NOT NULL CHECK(padding BETWEEN 4 AND 12), expected_version integer NOT NULL CHECK(expected_version>=0), target_id uuid, new_policy_id uuid UNIQUE,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text, result_policy_id uuid,
 UNIQUE(company_id,id), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id), FOREIGN KEY(company_id,target_id) REFERENCES document_numbering_policies(company_id,id), FOREIGN KEY(company_id,result_policy_id) REFERENCES document_numbering_policies(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((expected_version=0 AND target_id IS NULL AND new_policy_id IS NOT NULL) OR (expected_version>0 AND target_id IS NOT NULL AND new_policy_id IS NULL)),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND result_policy_id IS NULL) OR (state IN ('APPLIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500 AND ((state='APPLIED' AND result_policy_id IS NOT NULL AND result_policy_id=coalesce(target_id,new_policy_id)) OR (state='REJECTED' AND result_policy_id IS NULL))))
);
ALTER TABLE document_numbering_policies ADD FOREIGN KEY(company_id,last_request_id) REFERENCES numbering_change_requests(company_id,id);
CREATE INDEX numbering_change_queue ON numbering_change_requests(company_id,state,created_at DESC,id);
ALTER TABLE document_numbering_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE numbering_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON document_numbering_policies USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE POLICY company_isolation ON numbering_change_requests USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE FUNCTION numbering_format(p_company uuid,p_branch uuid,p_type text,p_year integer) RETURNS TABLE(prefix text,padding integer,version integer,policy_id uuid) LANGUAGE sql STABLE AS $$
 SELECT coalesce(p.prefix,d.prefix),coalesce(p.padding,d.padding),coalesce(p.version,0),p.id FROM document_numbering_defaults d LEFT JOIN document_numbering_policies p ON p.company_id=p_company AND p.branch_id=p_branch AND p.document_type=d.document_type AND p.calendar_year=p_year WHERE d.document_type=p_type
$$;
CREATE FUNCTION assert_numbering_format(p_company uuid,p_branch uuid,p_type text,p_year integer,p_prefix text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM branches WHERE company_id=p_company AND id=p_branch AND active) THEN RAISE EXCEPTION 'NUMBERING_BRANCH' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM document_numbering_defaults WHERE document_type=p_type) THEN RAISE EXCEPTION 'NUMBERING_TYPE' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM document_sequences WHERE company_id=p_company AND branch_id=p_branch AND document_type=p_type AND financial_year=p_year) THEN RAISE EXCEPTION 'NUMBERING_INITIALIZED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM document_numbering_defaults d LEFT JOIN document_numbering_policies p ON p.company_id=p_company AND p.branch_id=p_branch AND p.calendar_year=p_year AND p.document_type=d.document_type LEFT JOIN document_sequences s ON s.company_id=p_company AND s.branch_id=p_branch AND s.financial_year=p_year AND s.document_type=d.document_type WHERE d.document_type<>p_type AND coalesce(s.prefix,p.prefix,d.prefix)=p_prefix)
 OR EXISTS(SELECT 1 FROM document_sequences WHERE company_id=p_company AND branch_id=p_branch AND financial_year=p_year AND document_type<>p_type AND prefix=p_prefix) THEN RAISE EXCEPTION 'NUMBERING_PREFIX' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION numbering_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'numbering requests cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'numbering actor/scope required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('numbering:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' THEN RAISE EXCEPTION 'numbering proposal authority required' USING ERRCODE='23514'; END IF;
  PERFORM assert_numbering_format(NEW.company_id,NEW.branch_id,NEW.document_type,NEW.calendar_year,NEW.prefix);
 ELSE
  IF NOT account_configuration_allowed('numbering:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by THEN RAISE EXCEPTION 'independent terminal numbering review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason','result_policy_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason','result_policy_id']) THEN RAISE EXCEPTION 'numbering proposal payload immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER numbering_request_integrity BEFORE INSERT OR UPDATE OR DELETE ON numbering_change_requests FOR EACH ROW EXECUTE FUNCTION numbering_request_guard();
CREATE FUNCTION approved_numbering_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r numbering_change_requests%ROWTYPE;
BEGIN
 IF current_user<>'erp_runtime' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('numbering:approve') THEN RAISE EXCEPTION 'numbering configuration authority required' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM numbering_change_requests WHERE company_id=NEW.company_id AND id=NEW.last_request_id AND state='APPLIED' AND reviewed_by=actor_uuid() AND reviewed_at=now();
 IF NOT FOUND OR r.result_policy_id<>NEW.id OR (NEW.branch_id,NEW.document_type,NEW.calendar_year,NEW.prefix,NEW.padding,NEW.version) IS DISTINCT FROM (r.branch_id,r.document_type,r.calendar_year,r.prefix,r.padding,r.expected_version+1) THEN RAISE EXCEPTION 'numbering format must match approved request' USING ERRCODE='23514'; END IF;
 PERFORM assert_numbering_format(NEW.company_id,NEW.branch_id,NEW.document_type,NEW.calendar_year,NEW.prefix);
 IF TG_OP='INSERT' THEN
  IF r.expected_version<>0 OR NEW.id IS DISTINCT FROM r.new_policy_id OR NEW.created_by IS DISTINCT FROM r.created_by OR NEW.created_at IS DISTINCT FROM now() OR NEW.updated_by IS NOT NULL OR NEW.updated_at IS NOT NULL THEN RAISE EXCEPTION 'numbering creation origin mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF r.target_id IS DISTINCT FROM OLD.id OR r.expected_version<>OLD.version OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() OR (to_jsonb(NEW)-ARRAY['prefix','padding','version','updated_by','updated_at','last_request_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['prefix','padding','version','updated_by','updated_at','last_request_id']) THEN RAISE EXCEPTION 'numbering revision origin/version mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approved_numbering_integrity BEFORE INSERT OR UPDATE OR DELETE ON document_numbering_policies FOR EACH ROW EXECUTE FUNCTION approved_numbering_guard();
CREATE FUNCTION numbering_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NULL; END IF;
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'NUMBERING_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'NUMBERING_CHANGE_APPROVE' ELSE 'NUMBERING_CHANGE_REJECT' END;
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='NUMBERING_CONFIGURATION' AND entity_id=NEW.id AND actor_id=actor_uuid() AND created_at=now() AND action=action_name AND new_values->'after'=to_jsonb(NEW)) THEN RAISE EXCEPTION 'numbering request requires exact atomic audit' USING ERRCODE='23514'; END IF;
 IF NEW.state='APPLIED' AND NOT EXISTS(SELECT 1 FROM document_numbering_policies WHERE company_id=NEW.company_id AND id=NEW.result_policy_id AND last_request_id=NEW.id AND version=NEW.expected_version+1 AND prefix=NEW.prefix AND padding=NEW.padding) THEN RAISE EXCEPTION 'numbering publication must be atomic with review' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER numbering_request_audit AFTER INSERT OR UPDATE ON numbering_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION numbering_request_audited();
CREATE FUNCTION approved_numbering_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='erp_runtime' AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='NUMBERING_CONFIGURATION' AND entity_id=NEW.last_request_id AND actor_id=actor_uuid() AND created_at=now() AND action='NUMBERING_CHANGE_APPROVE' AND new_values->'policyAfter'=to_jsonb(NEW)) THEN RAISE EXCEPTION 'numbering mutation requires exact atomic audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER approved_numbering_audit AFTER INSERT OR UPDATE ON document_numbering_policies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION approved_numbering_audited();
GRANT SELECT,INSERT ON numbering_change_requests,document_numbering_policies TO erp_runtime;
GRANT UPDATE(state,reviewed_by,reviewed_at,review_reason,result_policy_id) ON numbering_change_requests TO erp_runtime;
GRANT UPDATE(prefix,padding,version,updated_by,updated_at,last_request_id) ON document_numbering_policies TO erp_runtime;
CREATE OR REPLACE FUNCTION sequence_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg record;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NEW; END IF;
 IF actor_uuid() IS NULL OR NEW.company_id IS DISTINCT FROM company_uuid() THEN RAISE EXCEPTION 'sequence requires authenticated transaction context' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO cfg FROM numbering_format(NEW.company_id,NEW.branch_id,NEW.document_type,NEW.financial_year);
  IF NOT FOUND OR NEW.prefix<>cfg.prefix OR NEW.padding<>cfg.padding OR NEW.last_value<>1 THEN RAISE EXCEPTION 'sequence must use resolved registered format and start at one' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.company_id,NEW.branch_id,NEW.document_type,NEW.financial_year,NEW.prefix,NEW.padding) IS DISTINCT FROM (OLD.company_id,OLD.branch_id,OLD.document_type,OLD.financial_year,OLD.prefix,OLD.padding) OR NEW.last_value<>OLD.last_value+1 THEN RAISE EXCEPTION 'sequence identity/format immutable; counter must increment exactly once' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.allocated_by=actor_uuid();NEW.allocated_at=now();RETURN NEW;
END $$;
COMMIT;
