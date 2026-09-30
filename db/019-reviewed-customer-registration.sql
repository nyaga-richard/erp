-- Initial customer masters only: no AR entries, balances or financial posting.
BEGIN;
INSERT INTO permissions(code,description) VALUES('customers:view','Read authorized customer profile and credit-policy metadata'),('customers:propose','Propose initial customer registration'),('customers:approve','Independently approve or reject customer registration') ON CONFLICT DO NOTHING;
CREATE TABLE customer_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 number text NOT NULL CHECK(number~'^[A-Z][A-Z0-9_-]{0,31}$'),name text NOT NULL CHECK(name=trim(name) AND length(name) BETWEEN 2 AND 160),
 phone text CHECK(length(phone) BETWEEN 3 AND 40 AND phone=trim(phone)),email text CHECK(length(email) BETWEEN 3 AND 254 AND email=trim(email)),address text CHECK(length(address) BETWEEN 2 AND 1000 AND address=trim(address)),tax_pin text CHECK(tax_pin~'^[A-Z][0-9]{9}[A-Z]$'),
 customer_type text NOT NULL CHECK(customer_type IN ('REGISTERED','WALK_IN')),credit_limit money_amount NOT NULL CHECK(credit_limit BETWEEN 0 AND 9999999999999999.99),payment_terms_days integer NOT NULL CHECK(payment_terms_days BETWEEN 0 AND 3650),currency char(3) NOT NULL REFERENCES currencies(code),control_account_id uuid,tax_category_id uuid,
 reason text NOT NULL CHECK(reason=trim(reason) AND length(reason) BETWEEN 5 AND 500),new_customer_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,new_account_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_reason text,
 UNIQUE(company_id,id),FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (state<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason=trim(review_reason) AND length(review_reason) BETWEEN 5 AND 500)),
 CHECK((customer_type='REGISTERED' AND control_account_id IS NOT NULL) OR (customer_type='WALK_IN' AND control_account_id IS NULL AND credit_limit=0 AND payment_terms_days=0 AND phone IS NULL AND email IS NULL AND address IS NULL AND tax_pin IS NULL))
);
ALTER TABLE customers ADD publication_request_id uuid UNIQUE,ADD approved_by uuid REFERENCES users(id),ADD approved_at timestamptz,ADD version integer NOT NULL DEFAULT 0 CHECK(version IN (0,1));
ALTER TABLE customers ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES customer_change_requests(company_id,id);
CREATE UNIQUE INDEX one_governed_walk_in ON customers(company_id) WHERE publication_request_id IS NOT NULL AND customer_type='WALK_IN';
CREATE INDEX customer_request_search ON customer_change_requests(company_id,created_at,id);
CREATE FUNCTION customer_request_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(r)||jsonb_build_object('credit_limit',r.credit_limit::text) FROM customer_change_requests r WHERE r.id=p_id $$;
CREATE FUNCTION customer_publication_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(c)||jsonb_build_object('credit_limit',c.credit_limit::text,'account',(SELECT to_jsonb(a) FROM customer_accounts a WHERE a.company_id=c.company_id AND a.customer_id=c.id)) FROM customers c WHERE c.publication_request_id=p_id $$;
CREATE FUNCTION assert_customer_request(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r customer_change_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM customer_change_requests WHERE id=p_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM companies WHERE id=r.company_id AND active AND base_currency=r.currency) THEN RAISE EXCEPTION 'customer company currency unavailable' USING ERRCODE='23514'; END IF;
 IF r.control_account_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounts a WHERE a.company_id=r.company_id AND a.id=r.control_account_id AND a.active AND a.postable AND a.account_type='ASSET' AND a.control_type='AR' AND NOT EXISTS(SELECT 1 FROM accounts child WHERE child.company_id=a.company_id AND child.parent_id=a.id)) THEN RAISE EXCEPTION 'eligible same-company AR leaf required' USING ERRCODE='23514'; END IF;
 IF r.tax_category_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tax_categories WHERE company_id=r.company_id AND id=r.tax_category_id AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'governed same-company tax classification required' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION customer_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'customer request immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'customer context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('customers:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' OR NEW.reason IS DISTINCT FROM current_setting('app.reason',true) THEN RAISE EXCEPTION 'customer proposal authority required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT account_configuration_allowed('customers:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by OR NEW.review_reason IS DISTINCT FROM current_setting('app.reason',true) THEN RAISE EXCEPTION 'independent customer review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) THEN RAISE EXCEPTION 'customer proposal payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state='APPLIED' THEN PERFORM assert_customer_request(NEW.id); END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER customer_request_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_change_requests FOR EACH ROW EXECUTE FUNCTION customer_request_guard();
CREATE FUNCTION customer_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_change_requests%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.publication_request_id IS NOT NULL OR current_user='erp_runtime' THEN RAISE EXCEPTION 'governed customer immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF current_user<>'erp_runtime' AND NEW.publication_request_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM customer_change_requests WHERE company_id=NEW.company_id AND id=NEW.publication_request_id AND state='APPLIED';
 IF NOT FOUND OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('customers:approve') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'customer requires current independent review' USING ERRCODE='23514'; END IF;
 expected=jsonb_build_object('id',r.new_customer_id,'company_id',r.company_id,'created_by',r.created_by,'created_at',now(),'number',r.number,'name',r.name,'phone',r.phone,'email',r.email,'address',r.address,'tax_pin',r.tax_pin,'payment_terms_days',r.payment_terms_days,'currency',r.currency,'active',true,'customer_type',r.customer_type,'credit_limit',r.credit_limit,'credit_hold',false,'tax_category_id',r.tax_category_id,'publication_request_id',r.id,'approved_by',r.reviewed_by,'approved_at',r.reviewed_at,'version',1);
 IF to_jsonb(NEW) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'customer must exactly match approved payload' USING ERRCODE='23514'; END IF;
 PERFORM assert_customer_request(r.id);RETURN NEW;
END $$;
CREATE TRIGGER customer_header_guard BEFORE INSERT OR UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION customer_header_guard();
CREATE FUNCTION customer_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_change_requests%ROWTYPE;p customers%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF current_user='erp_runtime' OR EXISTS(SELECT 1 FROM customers WHERE id=OLD.customer_id AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'customer binding immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO p FROM customers WHERE company_id=NEW.company_id AND id=NEW.customer_id;
 IF current_user<>'erp_runtime' AND p.publication_request_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM customer_change_requests WHERE id=p.publication_request_id AND state='APPLIED';
 IF NOT FOUND OR r.customer_type<>'REGISTERED' OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('customers:approve') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() OR to_jsonb(NEW) IS DISTINCT FROM jsonb_build_object('id',r.new_account_id,'company_id',r.company_id,'created_by',r.created_by,'created_at',now(),'customer_id',r.new_customer_id,'control_account_id',r.control_account_id) THEN RAISE EXCEPTION 'customer binding requires exact current publication' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER customer_account_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_accounts FOR EACH ROW EXECUTE FUNCTION customer_account_guard();
CREATE FUNCTION customer_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb;published jsonb;action_name text;
BEGIN
 before_value=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD)||jsonb_build_object('credit_limit',OLD.credit_limit::text) END;
 published=coalesce(customer_publication_snapshot(NEW.id),'null'::jsonb);
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'CUSTOMER_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'CUSTOMER_CHANGE_APPROVE' ELSE 'CUSTOMER_CHANGE_REJECT' END;
 IF NEW.state IN ('PENDING','APPLIED') THEN PERFORM assert_customer_request(NEW.id); END IF;
 IF NEW.state='APPLIED' THEN
  IF published='null'::jsonb OR (NEW.customer_type='REGISTERED' AND (published->'account'->>'control_account_id') IS DISTINCT FROM NEW.control_account_id::text) OR (NEW.customer_type='WALK_IN' AND published->'account'<>'null'::jsonb) THEN RAISE EXCEPTION 'complete atomic customer publication required' USING ERRCODE='23514'; END IF;
 ELSIF published<>'null'::jsonb THEN RAISE EXCEPTION 'unapproved customer publication forbidden' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='CUSTOMER_CONFIGURATION' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=action_name AND a.reason=current_setting('app.reason',true) AND a.new_values=jsonb_build_object('before',before_value,'after',customer_request_snapshot(NEW.id),'published',published)) THEN RAISE EXCEPTION 'exact atomic customer audit required' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_request_audited AFTER INSERT OR UPDATE ON customer_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_request_audited();
-- Recheck the final row after every BEFORE trigger, including a deliberately
-- corrupted row. Reuse identical authority/payload guards instead of a second engine.
CREATE CONSTRAINT TRIGGER customer_request_final_guard AFTER INSERT OR UPDATE ON customer_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_request_guard();
CREATE CONSTRAINT TRIGGER customer_header_final_guard AFTER INSERT ON customers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_header_guard();
CREATE CONSTRAINT TRIGGER customer_account_final_guard AFTER INSERT ON customer_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_account_guard();
GRANT SELECT,INSERT,UPDATE ON customer_change_requests TO erp_runtime;
GRANT SELECT,INSERT ON customers,customer_accounts TO erp_runtime;
REVOKE DELETE,TRUNCATE ON customer_change_requests FROM erp_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON customers,customer_accounts FROM erp_runtime;
COMMIT;
