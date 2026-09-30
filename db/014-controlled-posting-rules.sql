-- Reviewed posting-rule configuration; contracts do not activate operational workflows.
-- Applies atomically after a pre-migration encrypted backup.
BEGIN;
CREATE TABLE posting_event_contracts(
 event_type text NOT NULL CHECK(event_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
 contract_version integer NOT NULL CHECK(contract_version>0),
 workflow_status text NOT NULL DEFAULT 'CONFIGURATION_ONLY' CHECK(workflow_status='CONFIGURATION_ONLY'),
 origin_migration text NOT NULL CHECK(origin_migration ~ '^[0-9]+[-a-z0-9]+\.sql$'),
 migration_principal text NOT NULL DEFAULT current_user,
 registered_at timestamptz NOT NULL DEFAULT now(),
 sealed_at timestamptz,
 PRIMARY KEY(event_type,contract_version)
);
CREATE TABLE posting_event_leg_contracts(
 event_type text NOT NULL,
 contract_version integer NOT NULL,
 leg_code text NOT NULL CHECK(leg_code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
 side text NOT NULL CHECK(side IN ('DEBIT','CREDIT')),
 amount_key text NOT NULL CHECK(amount_key ~ '^[a-z][a-zA-Z0-9_]{0,47}$' AND amount_key NOT IN ('constructor','prototype','__proto__')),
 PRIMARY KEY(event_type,contract_version,leg_code),
 FOREIGN KEY(event_type,contract_version) REFERENCES posting_event_contracts(event_type,contract_version)
);
CREATE TABLE posting_event_leg_eligibility(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_type text NOT NULL,
 contract_version integer NOT NULL,
 leg_code text NOT NULL,
 account_type text NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
 control_type text CHECK(control_type ~ '^[A-Z][A-Z0-9_]{1,39}$'),
 UNIQUE NULLS NOT DISTINCT(event_type,contract_version,leg_code,account_type,control_type),
 FOREIGN KEY(event_type,contract_version,leg_code) REFERENCES posting_event_leg_contracts(event_type,contract_version,leg_code)
);
CREATE FUNCTION posting_contract_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'registered event contracts are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.migration_principal<>current_user OR NEW.registered_at<>now() OR NEW.sealed_at IS NOT NULL THEN RAISE EXCEPTION 'contract registration must retain its actual migration principal and transaction time' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.sealed_at IS NOT NULL OR NEW.sealed_at IS DISTINCT FROM now() OR (to_jsonb(OLD)-'sealed_at') IS DISTINCT FROM (to_jsonb(NEW)-'sealed_at') THEN RAISE EXCEPTION 'contract permits only one-way sealing in its registration transaction' USING ERRCODE='23514'; END IF;
  IF OLD.registered_at<>now() THEN RAISE EXCEPTION 'contract sealing must be atomic with registration' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posting_contract_header_guard BEFORE INSERT OR UPDATE OR DELETE ON posting_event_contracts FOR EACH ROW EXECUTE FUNCTION posting_contract_header_guard();
CREATE FUNCTION posting_contract_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sealed timestamptz;
BEGIN
 SELECT sealed_at INTO sealed FROM posting_event_contracts WHERE event_type=NEW.event_type AND contract_version=NEW.contract_version FOR UPDATE;
 IF NOT FOUND OR sealed IS NOT NULL THEN RAISE EXCEPTION 'sealed contract definitions cannot be extended' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posting_contract_leg_insert BEFORE INSERT ON posting_event_leg_contracts FOR EACH ROW EXECUTE FUNCTION posting_contract_child_guard();
CREATE TRIGGER posting_contract_eligibility_insert BEFORE INSERT ON posting_event_leg_eligibility FOR EACH ROW EXECUTE FUNCTION posting_contract_child_guard();
CREATE TRIGGER posting_contract_leg_immutable BEFORE UPDATE OR DELETE ON posting_event_leg_contracts FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER posting_contract_eligibility_immutable BEFORE UPDATE OR DELETE ON posting_event_leg_eligibility FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION posting_contract_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sealed timestamptz; legs integer; sides integer;
BEGIN
 SELECT sealed_at INTO sealed FROM posting_event_contracts WHERE event_type=NEW.event_type AND contract_version=NEW.contract_version;
 SELECT count(*),count(DISTINCT side) INTO legs,sides FROM posting_event_leg_contracts WHERE event_type=NEW.event_type AND contract_version=NEW.contract_version;
 IF sealed IS NULL OR legs NOT BETWEEN 2 AND 100 OR sides<>2 OR EXISTS(
  SELECT 1 FROM posting_event_leg_contracts l WHERE l.event_type=NEW.event_type AND l.contract_version=NEW.contract_version
  AND (SELECT count(*) FROM posting_event_leg_eligibility e WHERE e.event_type=l.event_type AND e.contract_version=l.contract_version AND e.leg_code=l.leg_code) NOT BETWEEN 1 AND 20
 ) THEN RAISE EXCEPTION 'event contract must commit sealed with complete eligible debit and credit legs' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER posting_contract_complete AFTER INSERT OR UPDATE ON posting_event_contracts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION posting_contract_complete();
INSERT INTO posting_event_contracts(event_type,contract_version,origin_migration) VALUES
 ('GOODS_RECEIVED',1,'014-controlled-posting-rules.sql'),
 ('STOCK_LOSS',1,'014-controlled-posting-rules.sql'),
 ('STOCK_GAIN',1,'014-controlled-posting-rules.sql');
INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES
 ('GOODS_RECEIVED',1,'INVENTORY','DEBIT','stockValue'),
 ('GOODS_RECEIVED',1,'GRNI','CREDIT','stockValue'),
 ('STOCK_LOSS',1,'LOSS','DEBIT','stockValue'),
 ('STOCK_LOSS',1,'INVENTORY','CREDIT','stockValue'),
 ('STOCK_GAIN',1,'INVENTORY','DEBIT','stockValue'),
 ('STOCK_GAIN',1,'GAIN','CREDIT','stockValue');
INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES
 ('GOODS_RECEIVED',1,'INVENTORY','ASSET','INVENTORY'),
 ('GOODS_RECEIVED',1,'GRNI','LIABILITY','GRNI'),
 ('STOCK_LOSS',1,'LOSS','EXPENSE',NULL),
 ('STOCK_LOSS',1,'INVENTORY','ASSET','INVENTORY'),
 ('STOCK_GAIN',1,'INVENTORY','ASSET','INVENTORY'),
 ('STOCK_GAIN',1,'GAIN','REVENUE',NULL),
 ('STOCK_GAIN',1,'GAIN','EXPENSE',NULL);
UPDATE posting_event_contracts SET sealed_at=now();
REVOKE ALL ON posting_event_contracts,posting_event_leg_contracts,posting_event_leg_eligibility FROM PUBLIC,erp_runtime,erp_auth_worker;
GRANT SELECT ON posting_event_contracts,posting_event_leg_contracts,posting_event_leg_eligibility TO erp_runtime;
INSERT INTO permissions(code,description) VALUES('rules:view','Inspect posting rules and eligible account configuration'),('rules:propose','Propose posting mappings or prospective retirement'),('rules:approve','Independently review posting rule changes') ON CONFLICT DO NOTHING;
ALTER TABLE accounting_rule_sets ADD COLUMN contract_version integer, ADD COLUMN publication_request_id uuid UNIQUE;
ALTER TABLE accounting_rule_sets ADD FOREIGN KEY(event_type,contract_version) REFERENCES posting_event_contracts(event_type,contract_version);
CREATE TABLE posting_rule_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), kind text NOT NULL CHECK(kind IN ('CREATE','RETIRE')),
 event_type text, contract_version integer, valid_from date, valid_to date, priority integer, branch_id uuid, warehouse_id uuid,
 target_id uuid, new_rule_id uuid UNIQUE, expected_version integer, effective_through date,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text,
 UNIQUE(company_id,id), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id), FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 FOREIGN KEY(event_type,contract_version) REFERENCES posting_event_contracts(event_type,contract_version), FOREIGN KEY(company_id,target_id) REFERENCES accounting_rule_sets(company_id,id),
 CHECK((kind='CREATE' AND event_type IS NOT NULL AND contract_version IS NOT NULL AND valid_from IS NOT NULL AND priority IS NOT NULL AND new_rule_id IS NOT NULL AND target_id IS NULL AND expected_version IS NULL AND effective_through IS NULL AND (valid_to IS NULL OR valid_to>=valid_from) AND (warehouse_id IS NULL OR branch_id IS NOT NULL)) OR (kind='RETIRE' AND target_id IS NOT NULL AND expected_version IS NOT NULL AND expected_version>=0 AND effective_through IS NOT NULL AND event_type IS NULL AND contract_version IS NULL AND valid_from IS NULL AND valid_to IS NULL AND priority IS NULL AND branch_id IS NULL AND warehouse_id IS NULL AND new_rule_id IS NULL)),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (state IN ('APPLIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500 AND review_reason IS NOT NULL))
);
ALTER TABLE accounting_rule_sets ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES posting_rule_change_requests(company_id,id);
CREATE TABLE posting_rule_change_legs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), request_id uuid NOT NULL, leg_code text NOT NULL, account_id uuid NOT NULL,
 UNIQUE(company_id,request_id,leg_code), FOREIGN KEY(company_id,request_id) REFERENCES posting_rule_change_requests(company_id,id), FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id)
);
CREATE TABLE accounting_rule_retirements(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), rule_set_id uuid NOT NULL, version integer NOT NULL CHECK(version>0), effective_through date NOT NULL,
 request_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id), reviewed_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(created_by<>reviewed_by), UNIQUE(company_id,rule_set_id,version), FOREIGN KEY(company_id,rule_set_id) REFERENCES accounting_rule_sets(company_id,id), FOREIGN KEY(company_id,request_id) REFERENCES posting_rule_change_requests(company_id,id)
);
CREATE TABLE journal_posting_rule_applications(
 company_id uuid NOT NULL REFERENCES companies(id), journal_id uuid NOT NULL, rule_set_id uuid NOT NULL,
 PRIMARY KEY(company_id,journal_id,rule_set_id), FOREIGN KEY(company_id,journal_id) REFERENCES journal_entries(company_id,id), FOREIGN KEY(company_id,rule_set_id) REFERENCES accounting_rule_sets(company_id,id)
);
CREATE TRIGGER journal_rule_application_immutable BEFORE UPDATE OR DELETE ON journal_posting_rule_applications FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE INDEX posting_rule_queue ON posting_rule_change_requests(company_id,state,created_at DESC,id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['posting_rule_change_requests','posting_rule_change_legs','accounting_rule_retirements','journal_posting_rule_applications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_isolation ON %I USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid())',t);
END LOOP; END $$;
CREATE FUNCTION posting_rule_end(p_company uuid,p_rule uuid) RETURNS date LANGUAGE sql STABLE AS $$
 SELECT least(r.valid_to,(SELECT min(effective_through) FROM accounting_rule_retirements WHERE company_id=r.company_id AND rule_set_id=r.id)) FROM accounting_rule_sets r WHERE r.company_id=p_company AND r.id=p_rule
$$;
CREATE FUNCTION posting_request_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT to_jsonb(r)||jsonb_build_object('legs',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY leg_code) FROM posting_rule_change_legs l WHERE l.company_id=r.company_id AND l.request_id=r.id),'[]'::jsonb)) FROM posting_rule_change_requests r WHERE r.id=p_id
$$;
CREATE FUNCTION posting_rule_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT to_jsonb(r)||jsonb_build_object('legs',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY leg_code) FROM accounting_rule_legs l WHERE l.company_id=r.company_id AND l.rule_set_id=r.id),'[]'::jsonb)) FROM accounting_rule_sets r WHERE r.id=p_id
$$;
CREATE FUNCTION assert_posting_request(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r posting_rule_change_requests%ROWTYPE; target accounting_rule_sets%ROWTYPE; last_version integer; last_end date;
BEGIN
 SELECT * INTO r FROM posting_rule_change_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'RULE_REQUEST_MISSING' USING ERRCODE='23514'; END IF;
 IF r.kind='RETIRE' THEN
  SELECT * INTO target FROM accounting_rule_sets WHERE company_id=r.company_id AND id=r.target_id AND publication_request_id IS NOT NULL AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'RULE_TARGET' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max(version),0) INTO last_version FROM accounting_rule_retirements WHERE company_id=r.company_id AND rule_set_id=r.target_id AND request_id<>r.id;
  SELECT least(target.valid_to,min(effective_through)) INTO last_end FROM accounting_rule_retirements WHERE company_id=r.company_id AND rule_set_id=r.target_id AND request_id<>r.id;
  IF last_version<>r.expected_version THEN RAISE EXCEPTION 'RULE_VERSION' USING ERRCODE='23514'; END IF;
  IF r.effective_through<target.valid_from OR r.effective_through<(now() AT TIME ZONE 'Africa/Nairobi')::date OR (last_end IS NOT NULL AND r.effective_through>=last_end) OR EXISTS(SELECT 1 FROM journal_posting_rule_applications a JOIN journal_entries j ON j.company_id=a.company_id AND j.id=a.journal_id WHERE a.company_id=r.company_id AND a.rule_set_id=r.target_id AND j.accounting_date>r.effective_through) THEN RAISE EXCEPTION 'RULE_RETIREMENT_DATE' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM posting_rule_change_legs WHERE request_id=r.id) THEN RAISE EXCEPTION 'RULE_RETIREMENT_LEGS' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM posting_event_contracts WHERE event_type=r.event_type AND contract_version=r.contract_version AND sealed_at IS NOT NULL) THEN RAISE EXCEPTION 'RULE_CONTRACT' USING ERRCODE='23514'; END IF;
 IF r.valid_from<DATE '0001-01-01' OR r.valid_from>DATE '9999-12-31' OR r.valid_to>DATE '9999-12-31' OR (r.branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches WHERE company_id=r.company_id AND id=r.branch_id AND active)) OR (r.warehouse_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM warehouses WHERE company_id=r.company_id AND id=r.warehouse_id AND branch_id=r.branch_id AND active)) THEN RAISE EXCEPTION 'RULE_SCOPE' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM posting_rule_change_legs WHERE request_id=r.id)<>(SELECT count(*) FROM posting_event_leg_contracts WHERE event_type=r.event_type AND contract_version=r.contract_version) OR EXISTS(
  SELECT 1 FROM posting_rule_change_legs l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id JOIN companies co ON co.id=r.company_id
  WHERE l.request_id=r.id AND (NOT a.active OR NOT a.postable OR (a.currency IS NOT NULL AND a.currency<>co.base_currency) OR NOT EXISTS(SELECT 1 FROM posting_event_leg_eligibility e WHERE e.event_type=r.event_type AND e.contract_version=r.contract_version AND e.leg_code=l.leg_code AND e.account_type=a.account_type AND e.control_type IS NOT DISTINCT FROM a.control_type))
 ) THEN RAISE EXCEPTION 'RULE_ACCOUNTS' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM accounting_rule_sets a WHERE a.company_id=r.company_id AND a.event_type=r.event_type AND a.active AND a.publication_request_id IS NOT NULL AND a.id<>r.new_rule_id AND a.priority=r.priority
 AND ((a.branch_id IS NOT NULL)::int+(a.warehouse_id IS NOT NULL)::int+(a.product_id IS NOT NULL)::int+(a.category_id IS NOT NULL)::int+(a.tax_category_id IS NOT NULL)::int+(a.payment_method_id IS NOT NULL)::int)=((r.branch_id IS NOT NULL)::int+(r.warehouse_id IS NOT NULL)::int)
 AND (a.branch_id IS NULL OR r.branch_id IS NULL OR a.branch_id=r.branch_id) AND (a.warehouse_id IS NULL OR r.warehouse_id IS NULL OR a.warehouse_id=r.warehouse_id)
 AND (r.valid_to IS NULL OR a.valid_from<=r.valid_to) AND (posting_rule_end(a.company_id,a.id) IS NULL OR r.valid_from<=posting_rule_end(a.company_id,a.id))) THEN RAISE EXCEPTION 'RULE_OVERLAP' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION posting_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'posting requests immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'posting context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('rules:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' THEN RAISE EXCEPTION 'posting proposal authority required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT account_configuration_allowed('rules:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by THEN RAISE EXCEPTION 'independent posting review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) THEN RAISE EXCEPTION 'posting proposal payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state='APPLIED' THEN PERFORM assert_posting_request(NEW.id); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posting_request_guard BEFORE INSERT OR UPDATE OR DELETE ON posting_rule_change_requests FOR EACH ROW EXECUTE FUNCTION posting_request_guard();
CREATE FUNCTION posting_proposed_leg_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r posting_rule_change_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM posting_rule_change_requests WHERE company_id=NEW.company_id AND id=NEW.request_id;
 IF NOT FOUND OR r.kind<>'CREATE' OR r.state<>'PENDING' OR r.created_by IS DISTINCT FROM actor_uuid() OR r.created_at<>now() OR NOT account_configuration_allowed('rules:propose') OR NOT EXISTS(SELECT 1 FROM posting_event_leg_contracts WHERE event_type=r.event_type AND contract_version=r.contract_version AND leg_code=NEW.leg_code) THEN RAISE EXCEPTION 'proposal legs must match new authorized contract request' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER posting_proposed_leg_guard BEFORE INSERT ON posting_rule_change_legs FOR EACH ROW EXECUTE FUNCTION posting_proposed_leg_guard();
CREATE TRIGGER posting_proposed_leg_immutable BEFORE UPDATE OR DELETE ON posting_rule_change_legs FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION published_rule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r posting_rule_change_requests%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.publication_request_id IS NOT NULL OR current_user='erp_runtime' THEN RAISE EXCEPTION 'published rule definitions immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF current_user<>'erp_runtime' AND NEW.publication_request_id IS NULL AND NOT NEW.active THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 SELECT * INTO r FROM posting_rule_change_requests WHERE company_id=NEW.company_id AND id=NEW.publication_request_id AND kind='CREATE' AND state='APPLIED';
 IF NOT FOUND OR NOT account_configuration_allowed('rules:approve') OR NEW.approved_by IS DISTINCT FROM actor_uuid() OR NEW.company_id IS DISTINCT FROM company_uuid() OR NEW.id IS DISTINCT FROM r.new_rule_id OR NEW.created_by IS DISTINCT FROM r.created_by OR NEW.created_at IS DISTINCT FROM now() OR NEW.approved_by IS DISTINCT FROM r.reviewed_by OR NEW.approved_at IS DISTINCT FROM r.reviewed_at OR NEW.approved_at IS DISTINCT FROM now() OR NOT NEW.active
 OR (NEW.event_type,NEW.contract_version,NEW.valid_from,NEW.valid_to,NEW.priority,NEW.branch_id,NEW.warehouse_id) IS DISTINCT FROM (r.event_type,r.contract_version,r.valid_from,r.valid_to,r.priority,r.branch_id,r.warehouse_id)
 OR NEW.product_id IS NOT NULL OR NEW.category_id IS NOT NULL OR NEW.tax_category_id IS NOT NULL OR NEW.payment_method_id IS NOT NULL
 OR NEW.version<>(SELECT coalesce(max(version),0)+1 FROM accounting_rule_sets WHERE company_id=NEW.company_id AND event_type=NEW.event_type) THEN RAISE EXCEPTION 'rule must match independently applied request and next version' USING ERRCODE='23514'; END IF;
 PERFORM assert_posting_request(r.id);RETURN NEW;
END $$;
CREATE TRIGGER published_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_rule_sets FOR EACH ROW EXECUTE FUNCTION published_rule_guard();
CREATE FUNCTION published_leg_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a accounting_rule_sets%ROWTYPE; r posting_rule_change_requests%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF current_user='erp_runtime' OR EXISTS(SELECT 1 FROM accounting_rule_sets WHERE id=OLD.rule_set_id AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'published legs immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO a FROM accounting_rule_sets WHERE company_id=NEW.company_id AND id=NEW.rule_set_id;
 IF current_user<>'erp_runtime' AND a.publication_request_id IS NULL AND NOT a.active THEN RETURN NEW; END IF;
 SELECT * INTO r FROM posting_rule_change_requests WHERE id=a.publication_request_id;
 IF a.publication_request_id IS NULL OR NOT account_configuration_allowed('rules:approve') OR a.approved_by IS DISTINCT FROM actor_uuid() OR a.approved_at IS DISTINCT FROM now() OR NEW.created_by IS DISTINCT FROM a.created_by OR NEW.created_at IS DISTINCT FROM now() OR NOT EXISTS(SELECT 1 FROM posting_rule_change_legs l JOIN posting_event_leg_contracts c ON c.event_type=a.event_type AND c.contract_version=a.contract_version AND c.leg_code=l.leg_code WHERE l.request_id=r.id AND l.leg_code=NEW.leg_code AND l.account_id=NEW.account_id AND c.side=NEW.side AND c.amount_key=NEW.amount_key) THEN RAISE EXCEPTION 'published leg must match reviewed contract mapping' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER published_leg_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting_rule_legs FOR EACH ROW EXECUTE FUNCTION published_leg_guard();
CREATE FUNCTION retirement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r posting_rule_change_requests%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 SELECT * INTO r FROM posting_rule_change_requests WHERE company_id=NEW.company_id AND id=NEW.request_id AND kind='RETIRE' AND state='APPLIED';
 IF NOT FOUND OR NOT account_configuration_allowed('rules:approve') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() OR NEW.created_at IS DISTINCT FROM now() OR (NEW.rule_set_id,NEW.version,NEW.effective_through,NEW.created_by,NEW.reviewed_by) IS DISTINCT FROM (r.target_id,r.expected_version+1,r.effective_through,r.created_by,r.reviewed_by) THEN RAISE EXCEPTION 'retirement must match independent review' USING ERRCODE='23514'; END IF;
 PERFORM assert_posting_request(r.id);RETURN NEW;
END $$;
CREATE TRIGGER retirement_guard BEFORE INSERT ON accounting_rule_retirements FOR EACH ROW EXECUTE FUNCTION retirement_guard();
CREATE TRIGGER retirement_immutable BEFORE UPDATE OR DELETE ON accounting_rule_retirements FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION posting_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb; after_value jsonb; rule_value jsonb; retirement_value jsonb; action_name text;
BEGIN
 before_value=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD)||jsonb_build_object('legs',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY leg_code) FROM posting_rule_change_legs l WHERE request_id=NEW.id),'[]'::jsonb)) END;
 after_value=posting_request_snapshot(NEW.id);rule_value='null'::jsonb;retirement_value='null'::jsonb;
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'RULE_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'RULE_CHANGE_APPROVE' ELSE 'RULE_CHANGE_REJECT' END;
 IF NEW.state IN ('PENDING','APPLIED') THEN PERFORM assert_posting_request(NEW.id); END IF;
 IF NEW.state='APPLIED' AND NEW.kind='CREATE' THEN
  rule_value=posting_rule_snapshot(NEW.new_rule_id);
  IF rule_value IS NULL OR jsonb_array_length(rule_value->'legs')<>(SELECT count(*) FROM posting_rule_change_legs WHERE request_id=NEW.id) OR rule_value->>'publication_request_id'<>NEW.id::text THEN RAISE EXCEPTION 'publication must atomically include complete mapping' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state='APPLIED' THEN
  SELECT to_jsonb(r) INTO retirement_value FROM accounting_rule_retirements r WHERE request_id=NEW.id;
  IF retirement_value IS NULL THEN RAISE EXCEPTION 'retirement must be atomic with review' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='POSTING_RULE_CONFIGURATION' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=action_name AND a.new_values=jsonb_build_object('before',before_value,'after',after_value,'ruleAfter',rule_value,'retirementAfter',retirement_value)) THEN RAISE EXCEPTION 'posting configuration requires exact atomic before/after audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER posting_request_audited AFTER INSERT OR UPDATE ON posting_rule_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION posting_request_audited();
-- Publication and retirement can only occur in the request's review transaction.
-- Their matching deferred request guard checks full snapshots and complete legs.
GRANT SELECT ON accounting_rule_sets,accounting_rule_legs,posting_rule_change_requests,posting_rule_change_legs,accounting_rule_retirements,journal_posting_rule_applications TO erp_runtime;
GRANT INSERT ON accounting_rule_sets,accounting_rule_legs,posting_rule_change_requests,posting_rule_change_legs,accounting_rule_retirements TO erp_runtime;
GRANT UPDATE(state,reviewed_by,reviewed_at,review_reason) ON posting_rule_change_requests TO erp_runtime;


-- Preserve conservative warehouse closure across the new foreign key.
CREATE OR REPLACE FUNCTION warehouse_has_dependencies(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id JOIN public.companies c ON c.id=m.company_id JOIN public.user_roles ur ON ur.company_id=m.company_id AND ur.user_id=m.user_id JOIN public.role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE m.company_id=public.company_uuid() AND m.user_id=public.actor_uuid() AND m.active AND u.active AND c.active AND rp.permission_code IN ('warehouses:view','warehouses:manage')) THEN RAISE EXCEPTION 'warehouse dependency permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE company_id=public.company_uuid() AND id=p_id) THEN RAISE EXCEPTION 'warehouse dependency scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(
SELECT 1 FROM public.pos_terminals WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.inventory_movements WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.inventory_balances WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.stock_reservations WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.valuation_policies WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.stock_counts WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.stock_transfers WHERE company_id=public.company_uuid() AND (from_warehouse_id=p_id OR to_warehouse_id=p_id OR transit_warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.sales WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.sales_return_lines WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.purchase_requests WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.purchase_orders WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.grns WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.purchase_return_lines WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.accounting_rule_sets WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 UNION ALL
 SELECT 1 FROM public.posting_rule_change_requests WHERE company_id=public.company_uuid() AND (warehouse_id=p_id)
 );
END $$;
REVOKE ALL ON FUNCTION warehouse_has_dependencies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warehouse_has_dependencies(uuid) TO erp_runtime;

COMMIT;
