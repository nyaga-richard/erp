BEGIN;
INSERT INTO users(id,display_name,principal_type,service_code) VALUES('00000000-0000-4000-8000-000000000001','Authentication service','SYSTEM','AUTH_SERVICE');
INSERT INTO permissions(code,description) VALUES
 ('workspace:view','Open the company workspace'),('users:view','View company members'),('users:manage','Provision and change company membership'),
 ('roles:view','View company roles'),('roles:manage','Create/revise explicitly delegated roles'),('approvals:view','View workflow policies'),('approvals:manage','Propose workflow policies'),('approvals:publish','Independently publish workflow policies'),('security:view','View company security events'),
 ('journals:edit','Revise own unposted source'),('journals:cancel','Cancel unposted sources'),('journals:reject','Reject a pending source') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(company_id,role_id,permission_code) SELECT company_id,role_id,'workspace:view' FROM role_permissions WHERE permission_code='accounting:view' ON CONFLICT DO NOTHING;
ALTER TABLE roles ADD version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE memberships ADD version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD created_by uuid REFERENCES users(id), ADD updated_by uuid REFERENCES users(id), ADD updated_at timestamptz;
UPDATE memberships SET created_by='00000000-0000-4000-8000-000000000001';
ALTER TABLE memberships ALTER created_by SET NOT NULL;
CREATE TABLE permission_delegations(company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), permission_code text NOT NULL REFERENCES permissions(code), granted_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,user_id,permission_code), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id));
ALTER TABLE permission_delegations ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON permission_delegations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE TABLE security_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id), actor_id uuid NOT NULL REFERENCES users(id), subject_user_id uuid REFERENCES users(id), session_id uuid REFERENCES sessions(id), action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('SUCCESS','DENIED','ACCEPTED','FAILED')), request_id uuid NOT NULL, ip inet, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX security_company_time ON security_events(company_id,created_at DESC);
CREATE INDEX security_subject_time ON security_events(subject_user_id,created_at DESC);
CREATE TRIGGER security_immutable BEFORE UPDATE OR DELETE ON security_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TABLE auth_rate_limits(bucket text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK(attempts>0));
CREATE TABLE auth_delivery_outbox(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reset_token_id uuid NOT NULL UNIQUE REFERENCES password_reset_tokens(id), user_id uuid NOT NULL REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id), encrypted_payload text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, last_error_code text);
CREATE INDEX auth_delivery_pending ON auth_delivery_outbox(created_at) WHERE sent_at IS NULL;
ALTER TABLE approval_policies ADD published_by uuid REFERENCES users(id), ADD published_at timestamptz, ADD superseded_at timestamptz;
CREATE UNIQUE INDEX one_active_approval_threshold ON approval_policies(company_id,event_type,threshold_base) WHERE active AND branch_id IS NULL;
ALTER TABLE approval_decisions ALTER step_id DROP NOT NULL, ADD step_no integer NOT NULL DEFAULT 1 CHECK(step_no>0);
CREATE UNIQUE INDEX one_actor_per_revision ON approval_decisions(company_id,source_id,revision,created_by);
ALTER TABLE source_documents ADD approval_snapshot jsonb;
CREATE TABLE source_revisions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), source_id uuid NOT NULL, revision integer NOT NULL, snapshot jsonb NOT NULL, changed_by uuid NOT NULL REFERENCES users(id), reason text NOT NULL CHECK(length(trim(reason))>=5), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id,source_id,revision), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id));
ALTER TABLE source_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON source_revisions USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE TRIGGER source_revisions_immutable BEFORE UPDATE OR DELETE ON source_revisions FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE FUNCTION approval_policy_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'policy history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.active OR NEW.published_by IS NOT NULL THEN RAISE EXCEPTION 'invalid policy origin' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.company_id,NEW.created_by,NEW.created_at,NEW.event_type,NEW.version,NEW.threshold_base,NEW.independent_creator,NEW.independent_poster,NEW.branch_id) IS DISTINCT FROM (OLD.company_id,OLD.created_by,OLD.created_at,OLD.event_type,OLD.version,OLD.threshold_base,OLD.independent_creator,OLD.independent_poster,OLD.branch_id) THEN RAISE EXCEPTION 'policy rules immutable' USING ERRCODE='23514'; END IF;
  IF OLD.published_by IS NOT NULL THEN
   IF NOT (OLD.active AND NOT NEW.active AND NEW.superseded_at IS NOT NULL AND NEW.published_by=OLD.published_by AND NEW.published_at=OLD.published_at) THEN RAISE EXCEPTION 'published policy immutable' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT NEW.active OR NEW.published_by IS DISTINCT FROM actor_uuid() OR NEW.published_by=NEW.created_by OR NEW.published_at IS NULL OR NOT EXISTS(SELECT 1 FROM approval_steps WHERE company_id=NEW.company_id AND policy_id=NEW.id) THEN RAISE EXCEPTION 'independent policy publication required' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approval_policy_integrity BEFORE INSERT OR UPDATE OR DELETE ON approval_policies FOR EACH ROW EXECUTE FUNCTION approval_policy_guard();
CREATE FUNCTION approval_step_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'approval steps immutable' USING ERRCODE='23514'; END IF;
 IF NEW.created_by IS DISTINCT FROM actor_uuid() OR NOT EXISTS(SELECT 1 FROM approval_policies WHERE company_id=NEW.company_id AND id=NEW.policy_id AND published_by IS NULL AND created_by=actor_uuid()) THEN RAISE EXCEPTION 'invalid approval step origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approval_step_integrity BEFORE INSERT OR UPDATE OR DELETE ON approval_steps FOR EACH ROW EXECUTE FUNCTION approval_step_guard();
CREATE FUNCTION decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE; st jsonb; chosen jsonb; n integer;
BEGIN
 SELECT * INTO s FROM source_documents WHERE company_id=NEW.company_id AND id=NEW.source_id FOR UPDATE;
 IF NEW.created_by IS DISTINCT FROM actor_uuid() OR s.status<>'PENDING_APPROVAL' OR NEW.revision<>s.revision OR s.approval_snapshot IS NULL THEN RAISE EXCEPTION 'invalid approval decision' USING ERRCODE='23514'; END IF;
 IF (s.approval_snapshot->>'independentCreator')::boolean AND s.created_by=NEW.created_by THEN RAISE EXCEPTION 'creator cannot approve' USING ERRCODE='23514'; END IF;
 FOR st IN SELECT value FROM jsonb_array_elements(s.approval_snapshot->'steps') LOOP
  SELECT count(*) INTO n FROM approval_decisions WHERE company_id=s.company_id AND source_id=s.id AND revision=s.revision AND step_no=(st->>'number')::int AND decision='APPROVE';
  IF n<(st->>'minimumApprovers')::int THEN chosen=st; EXIT; END IF;
 END LOOP;
 IF chosen IS NULL OR NEW.step_no<>(chosen->>'number')::int OR NEW.step_id IS DISTINCT FROM nullif(chosen->>'stepId','')::uuid THEN RAISE EXCEPTION 'approval steps must be ordered' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id JOIN memberships m ON m.company_id=ur.company_id AND m.user_id=ur.user_id WHERE ur.company_id=s.company_id AND ur.user_id=NEW.created_by AND m.active AND rp.permission_code=chosen->>'permission') THEN RAISE EXCEPTION 'step permission required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approval_decision_integrity BEFORE INSERT ON approval_decisions FOR EACH ROW EXECUTE FUNCTION decision_guard();

CREATE OR REPLACE FUNCTION source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE co companies%ROWTYPE; st jsonb; n integer; independent_creator boolean; independent_poster boolean; revising boolean:=false;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sources cannot be deleted' USING ERRCODE='23514'; END IF;
 IF actor_uuid() IS NULL OR NEW.company_id IS DISTINCT FROM company_uuid() THEN RAISE EXCEPTION 'actor/company context required' USING ERRCODE='23514'; END IF;
 SELECT * INTO co FROM companies WHERE id=NEW.company_id;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor_uuid() OR NEW.status<>'DRAFT' OR NEW.approval_snapshot IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.posted_by IS NOT NULL OR NEW.cancelled_by IS NOT NULL THEN RAISE EXCEPTION 'invalid source creator/state' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status IN ('POSTED','CANCELLED') THEN RAISE EXCEPTION 'posted/cancelled source immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.created_by,NEW.created_at,NEW.company_id,NEW.branch_id,NEW.document_type,NEW.document_number,NEW.original_document_id,NEW.reversal_reason) IS DISTINCT FROM (OLD.created_by,OLD.created_at,OLD.company_id,OLD.branch_id,OLD.document_type,OLD.document_number,OLD.original_document_id,OLD.reversal_reason) THEN RAISE EXCEPTION 'source origin immutable' USING ERRCODE='23514'; END IF;
  IF NEW.updated_by IS DISTINCT FROM actor_uuid() THEN RAISE EXCEPTION 'invalid update actor' USING ERRCODE='23514'; END IF;
  revising=NEW.status='DRAFT' AND NEW.revision=OLD.revision+1;
  IF revising THEN
   IF NEW.created_by<>actor_uuid() OR NEW.approved_by IS NOT NULL OR NEW.approval_snapshot IS NOT NULL OR NEW.posted_by IS NOT NULL THEN RAISE EXCEPTION 'revision must invalidate approvals' USING ERRCODE='23514'; END IF;
   IF OLD.document_type='JOURNAL_REVERSAL' AND NEW.payload IS DISTINCT FROM OLD.payload THEN RAISE EXCEPTION 'reversal lines immutable' USING ERRCODE='23514'; END IF;
   INSERT INTO source_revisions(company_id,source_id,revision,snapshot,changed_by,reason) VALUES(OLD.company_id,OLD.id,OLD.revision,to_jsonb(OLD),actor_uuid(),current_setting('app.reason',true));
  ELSE
   IF (NEW.payload,NEW.business_date,NEW.currency,NEW.exchange_rate,NEW.description,NEW.revision) IS DISTINCT FROM (OLD.payload,OLD.business_date,OLD.currency,OLD.exchange_rate,OLD.description,OLD.revision) THEN RAISE EXCEPTION 'content change requires a new revision' USING ERRCODE='23514'; END IF;
   IF NEW.status<>OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status IN ('PENDING_APPROVAL','CANCELLED')) OR (OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR (OLD.status='APPROVED' AND NEW.status IN ('POSTED','CANCELLED')) OR (OLD.status='REJECTED' AND NEW.status='CANCELLED')) THEN RAISE EXCEPTION 'invalid state transition' USING ERRCODE='23514'; END IF;
   IF OLD.approved_by IS NOT NULL AND (NEW.approved_by,NEW.approved_at) IS DISTINCT FROM (OLD.approved_by,OLD.approved_at) THEN RAISE EXCEPTION 'approval immutable within revision' USING ERRCODE='23514'; END IF;
   IF NEW.approval_snapshot IS DISTINCT FROM OLD.approval_snapshot AND NOT (OLD.status='DRAFT' AND NEW.status='PENDING_APPROVAL') THEN RAISE EXCEPTION 'submitted approval snapshot immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF NEW.status='PENDING_APPROVAL' AND coalesce(jsonb_array_length(NEW.approval_snapshot->'steps'),0)<1 THEN RAISE EXCEPTION 'approval snapshot required' USING ERRCODE='23514'; END IF;
 independent_creator=coalesce((NEW.approval_snapshot->>'independentCreator')::boolean,co.independent_approval);
 independent_poster=coalesce((NEW.approval_snapshot->>'independentPoster')::boolean,co.independent_posting);
 IF NEW.status IN ('APPROVED','POSTED') AND NEW.approval_snapshot IS NOT NULL THEN
  FOR st IN SELECT value FROM jsonb_array_elements(NEW.approval_snapshot->'steps') LOOP
   SELECT count(*) INTO n FROM approval_decisions WHERE company_id=NEW.company_id AND source_id=NEW.id AND revision=NEW.revision AND step_no=(st->>'number')::int AND decision='APPROVE';
   IF n<(st->>'minimumApprovers')::int THEN RAISE EXCEPTION 'approval quorum incomplete' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF NEW.status='APPROVED' AND (NEW.approved_by IS DISTINCT FROM actor_uuid() OR (independent_creator AND NEW.created_by=NEW.approved_by)) THEN RAISE EXCEPTION 'independent approval required' USING ERRCODE='23514'; END IF;
 IF NEW.status='POSTED' AND (NEW.posted_by IS DISTINCT FROM actor_uuid() OR (independent_poster AND (NEW.posted_by=NEW.created_by OR NEW.posted_by=NEW.approved_by OR EXISTS(SELECT 1 FROM approval_decisions WHERE company_id=NEW.company_id AND source_id=NEW.id AND revision=NEW.revision AND created_by=NEW.posted_by AND decision='APPROVE')))) THEN RAISE EXCEPTION 'independent posting required' USING ERRCODE='23514'; END IF;
 IF NEW.status='CANCELLED' AND (NEW.cancelled_by IS DISTINCT FROM actor_uuid() OR NEW.cancelled_at IS NULL) THEN RAISE EXCEPTION 'cancellation actor required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
GRANT SELECT ON permission_delegations,security_events,auth_rate_limits,auth_delivery_outbox,password_reset_tokens,approval_policies,approval_steps,approval_decisions,source_revisions TO erp_runtime;
GRANT INSERT ON users,memberships,roles,role_permissions,user_roles,user_branch_scopes,security_events,auth_rate_limits,auth_delivery_outbox,password_reset_tokens,approval_policies,approval_steps,approval_decisions,source_revisions TO erp_runtime;
GRANT UPDATE(version,name) ON roles TO erp_runtime;
GRANT UPDATE(active,version,updated_by,updated_at) ON memberships TO erp_runtime;
GRANT DELETE ON role_permissions,user_roles,user_branch_scopes TO erp_runtime;
GRANT UPDATE(password_hash) ON users TO erp_runtime;
GRANT UPDATE(used_at) ON password_reset_tokens TO erp_runtime;
GRANT UPDATE ON auth_rate_limits TO erp_runtime;
GRANT UPDATE(sent_at,attempts,lease_until,last_error_code) ON auth_delivery_outbox TO erp_runtime;
GRANT UPDATE(active,published_by,published_at,superseded_at) ON approval_policies TO erp_runtime;
GRANT UPDATE(payload,business_date,currency,exchange_rate,description,revision,approval_snapshot,cancelled_by,cancelled_at) ON source_documents TO erp_runtime;
COMMIT;
