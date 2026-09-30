BEGIN;
INSERT INTO permissions(code,description) VALUES
 ('accounts:configuration:view','View account configuration and change requests'),
 ('accounts:propose','Propose non-control accounts and display-name corrections'),
 ('accounts:approve','Independently review and apply account change requests') ON CONFLICT DO NOTHING;
ALTER TABLE accounts ADD version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD created_at timestamptz, ADD updated_by uuid REFERENCES users(id), ADD updated_at timestamptz, ADD last_request_id uuid;
ALTER TABLE accounts ALTER created_at SET DEFAULT now();
CREATE TABLE account_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id),
 kind text NOT NULL CHECK(kind IN ('CREATE','RENAME')),
 target_id uuid, expected_version integer, new_account_id uuid UNIQUE,
 code text, name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 120), account_type text, parent_id uuid, postable boolean,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text, result_account_id uuid,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,target_id) REFERENCES accounts(company_id,id),
 FOREIGN KEY(company_id,parent_id) REFERENCES accounts(company_id,id),
 FOREIGN KEY(company_id,result_account_id) REFERENCES accounts(company_id,id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((kind='CREATE' AND target_id IS NULL AND expected_version IS NULL AND new_account_id IS NOT NULL AND code IS NOT NULL AND code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$' AND account_type IS NOT NULL AND account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE') AND postable IS NOT NULL)
 OR (kind='RENAME' AND target_id IS NOT NULL AND expected_version IS NOT NULL AND expected_version>0 AND new_account_id IS NULL AND code IS NULL AND account_type IS NULL AND parent_id IS NULL AND postable IS NULL)),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL AND result_account_id IS NULL)
 OR (state IN ('APPLIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500 AND ((state='APPLIED' AND result_account_id IS NOT NULL AND result_account_id=coalesce(target_id,new_account_id)) OR (state='REJECTED' AND result_account_id IS NULL))))
);
ALTER TABLE accounts ADD FOREIGN KEY(company_id,last_request_id) REFERENCES account_change_requests(company_id,id);
CREATE INDEX account_change_queue ON account_change_requests(company_id,state,created_at DESC,id);
ALTER TABLE account_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON account_change_requests USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE FUNCTION account_configuration_allowed(p_permission text) RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id JOIN public.companies co ON co.id=m.company_id JOIN public.user_roles ur ON ur.company_id=m.company_id AND ur.user_id=m.user_id JOIN public.role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE m.company_id=public.company_uuid() AND m.user_id=public.actor_uuid() AND m.active AND co.active AND u.active AND u.principal_type='HUMAN' AND rp.permission_code=p_permission)
$$;
CREATE FUNCTION account_change_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'account change deletion forbidden' USING ERRCODE='23514'; END IF;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'account configuration actor/scope required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('accounts:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' THEN RAISE EXCEPTION 'account proposal permission/origin required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT account_configuration_allowed('accounts:approve') THEN RAISE EXCEPTION 'account review permission required' USING ERRCODE='42501'; END IF;
  IF OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') THEN RAISE EXCEPTION 'terminal account request immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason','result_account_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason','result_account_id']) THEN RAISE EXCEPTION 'account proposal immutable' USING ERRCODE='23514'; END IF;
  IF NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by THEN RAISE EXCEPTION 'independent account reviewer required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_change_integrity BEFORE INSERT OR UPDATE OR DELETE ON account_change_requests FOR EACH ROW EXECUTE FUNCTION account_change_guard();
CREATE FUNCTION approved_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proposal account_change_requests%ROWTYPE;
BEGIN
 -- Trusted owner maintenance/seed is not exposed by the application.
 IF current_user<>'erp_runtime' THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'account deletion forbidden' USING ERRCODE='23514'; END IF;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('accounts:approve') THEN RAISE EXCEPTION 'approved account configuration permission required' USING ERRCODE='23514'; END IF;
 SELECT * INTO proposal FROM account_change_requests WHERE company_id=NEW.company_id AND id=NEW.last_request_id AND state='APPLIED' AND reviewed_by=actor_uuid() AND reviewed_at=now();
 IF NOT FOUND OR proposal.result_account_id<>NEW.id OR proposal.name<>NEW.name THEN RAISE EXCEPTION 'matching approved account request required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF proposal.kind<>'CREATE' OR NEW.id IS DISTINCT FROM proposal.new_account_id OR NEW.code IS DISTINCT FROM proposal.code OR NEW.account_type IS DISTINCT FROM proposal.account_type OR NEW.parent_id IS DISTINCT FROM proposal.parent_id OR NEW.postable IS DISTINCT FROM proposal.postable OR NEW.control_type IS NOT NULL OR NEW.currency IS NOT NULL OR NOT NEW.active OR NEW.created_by IS DISTINCT FROM proposal.created_by OR NEW.created_at IS DISTINCT FROM now() OR NEW.version<>1 OR NEW.updated_by IS NOT NULL OR NEW.updated_at IS NOT NULL THEN RAISE EXCEPTION 'account does not match approved creation' USING ERRCODE='23514'; END IF;
  IF NEW.parent_id IS NOT NULL THEN
   PERFORM 1 FROM accounts WHERE company_id=NEW.company_id AND id=NEW.parent_id AND active AND NOT postable AND control_type IS NULL AND account_type=NEW.account_type AND (currency IS NULL OR currency=(SELECT base_currency FROM companies WHERE id=NEW.company_id)) FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'account parent unavailable or incompatible' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF proposal.kind<>'RENAME' OR proposal.target_id<>OLD.id OR proposal.expected_version<>OLD.version OR NEW.version<>OLD.version+1 OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'account rename request/version mismatch' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['name','version','updated_by','updated_at','last_request_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','version','updated_by','updated_at','last_request_id']) THEN RAISE EXCEPTION 'account identity/classification immutable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approved_account_integrity BEFORE INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION approved_account_guard();
CREATE FUNCTION account_change_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NULL; END IF;
 action_name:=CASE NEW.state WHEN 'PENDING' THEN 'ACCOUNT_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'ACCOUNT_CHANGE_APPROVE' ELSE 'ACCOUNT_CHANGE_REJECT' END;
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='ACCOUNT_CONFIGURATION' AND entity_id=NEW.id AND actor_id=actor_uuid() AND created_at=now() AND action=action_name AND new_values->'after'=to_jsonb(NEW)) THEN RAISE EXCEPTION 'account change requires atomic matching audit' USING ERRCODE='23514'; END IF;
 IF NEW.state='APPLIED' AND NOT EXISTS(SELECT 1 FROM accounts WHERE company_id=NEW.company_id AND id=NEW.result_account_id AND last_request_id=NEW.id AND version=coalesce(NEW.expected_version,0)+1 AND name=NEW.name) THEN RAISE EXCEPTION 'account application must be atomic with review' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER account_change_audit AFTER INSERT OR UPDATE ON account_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION account_change_audited();
CREATE FUNCTION approved_account_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='erp_runtime' AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='ACCOUNT_CONFIGURATION' AND entity_id=NEW.last_request_id AND actor_id=actor_uuid() AND created_at=now() AND action='ACCOUNT_CHANGE_APPROVE' AND new_values->'accountAfter'=to_jsonb(NEW)) THEN RAISE EXCEPTION 'account mutation requires atomic matching audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER approved_account_audit AFTER INSERT OR UPDATE ON accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION approved_account_audited();
GRANT SELECT,INSERT ON account_change_requests TO erp_runtime;
GRANT UPDATE(state,reviewed_by,reviewed_at,review_reason,result_account_id) ON account_change_requests TO erp_runtime;
REVOKE UPDATE(active) ON accounts FROM erp_runtime;
GRANT INSERT ON accounts TO erp_runtime;
GRANT UPDATE(name,version,updated_by,updated_at,last_request_id) ON accounts TO erp_runtime;
COMMIT;
