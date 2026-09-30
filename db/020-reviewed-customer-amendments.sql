BEGIN;
INSERT INTO permissions(code,description) VALUES
 ('customers:amend:propose','Propose versioned customer profile amendments'),('customers:amend:approve','Independently review customer amendments'),('customers:credit:propose','Propose customer limit, terms or hold changes'),('customers:credit:approve','Independently review customer credit policy changes') ON CONFLICT DO NOTHING;
ALTER TABLE customers DROP CONSTRAINT customers_version_check;
ALTER TABLE customers ADD CONSTRAINT customers_version_check CHECK(version>=0);
CREATE TABLE customer_amendment_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),customer_id uuid NOT NULL,expected_version integer NOT NULL CHECK(expected_version>0 AND expected_version<2147483647),
 name text NOT NULL CHECK(name=trim(name) AND length(name) BETWEEN 2 AND 160),phone text CHECK(length(phone) BETWEEN 3 AND 40 AND phone=trim(phone)),email text CHECK(length(email) BETWEEN 3 AND 254 AND email=trim(email)),address text CHECK(length(address) BETWEEN 2 AND 1000 AND address=trim(address)),
 credit_limit money_amount NOT NULL CHECK(credit_limit BETWEEN 0 AND 9999999999999999.99),payment_terms_days integer NOT NULL CHECK(payment_terms_days BETWEEN 0 AND 3650),credit_hold boolean NOT NULL,
 before_snapshot jsonb NOT NULL,credit_changed boolean NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL CHECK(reason=trim(reason) AND length(reason) BETWEEN 5 AND 500),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_reason text,
 UNIQUE(company_id,id),FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (state<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND review_reason=trim(review_reason) AND length(review_reason) BETWEEN 5 AND 500))
);
CREATE UNIQUE INDEX one_customer_amendment_version ON customer_amendment_requests(company_id,customer_id,expected_version) WHERE state='APPLIED';
CREATE INDEX customer_amendment_history ON customer_amendment_requests(company_id,customer_id,created_at,id);
CREATE FUNCTION customer_row_snapshot(p customers) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(p)||jsonb_build_object('credit_limit',p.credit_limit::text,'account',(SELECT to_jsonb(a) FROM customer_accounts a WHERE a.company_id=p.company_id AND a.customer_id=p.id)) $$;
CREATE FUNCTION customer_current_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT customer_row_snapshot(c) FROM customers c WHERE id=p_id $$;
-- Original publication remains frozen; current metadata is a separate projection.
CREATE OR REPLACE FUNCTION customer_publication_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT coalesce((SELECT r.before_snapshot FROM customer_amendment_requests r WHERE r.company_id=c.company_id AND r.customer_id=c.id AND r.state='APPLIED' ORDER BY r.expected_version LIMIT 1),customer_row_snapshot(c)) FROM customers c WHERE c.publication_request_id=p_id
$$;
CREATE FUNCTION customer_amendment_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT to_jsonb(r)||jsonb_build_object('credit_limit',r.credit_limit::text) FROM customer_amendment_requests r WHERE id=p_id $$;
CREATE FUNCTION customer_amendment_after(r customer_amendment_requests) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT r.before_snapshot||jsonb_build_object('name',r.name,'phone',r.phone,'email',r.email,'address',r.address,'credit_limit',r.credit_limit::text,'payment_terms_days',r.payment_terms_days,'credit_hold',r.credit_hold,'version',r.expected_version+1) $$;
-- A scoped boolean only, not financial information. Discover every operational FK,
-- including future domains; unknown dependencies conservatively block policy edits.
CREATE FUNCTION customer_has_operations(p_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f record;used boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM customers WHERE id=p_id AND company_id=company_uuid() AND publication_request_id IS NOT NULL) OR NOT (account_configuration_allowed('customers:amend:propose') OR account_configuration_allowed('customers:amend:approve')) THEN RAISE EXCEPTION 'customer dependency scope required' USING ERRCODE='23514'; END IF;
 FOR f IN SELECT DISTINCT cl.relname,a.attname FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[array_position(con.confkey,(SELECT attnum FROM pg_attribute WHERE attrelid='public.customers'::regclass AND attname='id'))] WHERE con.contype='f' AND con.confrelid='public.customers'::regclass AND n.nspname='public' AND cl.relname NOT IN ('customer_accounts','customer_amendment_requests') LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE %I=$1)',f.relname,f.attname) INTO used USING p_id;
  IF used THEN RETURN true; END IF;
 END LOOP;RETURN false;
END $$;
REVOKE ALL ON FUNCTION customer_has_operations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_has_operations(uuid) TO erp_runtime;
CREATE FUNCTION customer_amendment_validate(r customer_amendment_requests,p_permission text,p_current boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c customers%ROWTYPE;changed boolean;
BEGIN
 SELECT * INTO c FROM customers WHERE company_id=r.company_id AND id=r.customer_id AND publication_request_id IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR NOT c.active THEN RAISE EXCEPTION 'active governed customer required' USING ERRCODE='23514'; END IF;
 IF p_current AND (c.version<>r.expected_version OR customer_row_snapshot(c) IS DISTINCT FROM r.before_snapshot) THEN RAISE EXCEPTION 'stale customer version or snapshot' USING ERRCODE='23514'; END IF;
 changed=(r.credit_limit,r.payment_terms_days,r.credit_hold) IS DISTINCT FROM ((r.before_snapshot->>'credit_limit')::numeric,(r.before_snapshot->>'payment_terms_days')::integer,(r.before_snapshot->>'credit_hold')::boolean);
 IF r.credit_changed IS DISTINCT FROM changed THEN RAISE EXCEPTION 'credit classification must match exact preimage' USING ERRCODE='23514'; END IF;
 IF changed AND NOT account_configuration_allowed(p_permission) THEN RAISE EXCEPTION 'current credit amendment permission required' USING ERRCODE='42501'; END IF;
 IF changed AND customer_has_operations(r.customer_id) THEN RAISE EXCEPTION 'credit policy requires operational exposure integration before changing used customer' USING ERRCODE='23514'; END IF;
 IF c.customer_type='WALK_IN' AND (r.credit_limit<>0 OR r.payment_terms_days<>0 OR r.credit_hold OR r.phone IS NOT NULL OR r.email IS NOT NULL OR r.address IS NOT NULL) THEN RAISE EXCEPTION 'walk-in cannot acquire credit or personal identity' USING ERRCODE='23514'; END IF;
 IF (customer_amendment_after(r)-'version') IS NOT DISTINCT FROM (r.before_snapshot-'version') THEN RAISE EXCEPTION 'customer amendment makes no change' USING ERRCODE='23514'; END IF;
 IF changed THEN PERFORM assert_customer_request(c.publication_request_id); END IF;
END $$;
CREATE FUNCTION customer_amendment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'customer amendment history immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'customer amendment context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('customers:amend:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' OR NEW.reason IS DISTINCT FROM current_setting('app.reason',true) THEN RAISE EXCEPTION 'customer amendment proposal authority required' USING ERRCODE='23514'; END IF;
  PERFORM customer_amendment_validate(NEW,'customers:credit:propose',true);
 ELSE
  IF NOT account_configuration_allowed('customers:amend:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by OR NEW.review_reason IS DISTINCT FROM current_setting('app.reason',true) THEN RAISE EXCEPTION 'independent customer amendment review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) THEN RAISE EXCEPTION 'customer amendment payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.credit_changed AND NOT account_configuration_allowed('customers:credit:approve') THEN RAISE EXCEPTION 'current credit review permission required' USING ERRCODE='42501'; END IF;
  IF NEW.state='APPLIED' THEN PERFORM customer_amendment_validate(NEW,'customers:credit:approve',TG_WHEN='BEFORE'); END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER customer_amendment_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_amendment_requests FOR EACH ROW EXECUTE FUNCTION customer_amendment_guard();
CREATE CONSTRAINT TRIGGER customer_amendment_final_guard AFTER INSERT OR UPDATE ON customer_amendment_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_amendment_guard();
CREATE FUNCTION customer_update_guard(p_old customers,p_new customers) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r customer_amendment_requests%ROWTYPE;
BEGIN
 IF p_old.publication_request_id IS NULL OR p_new.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('customers:amend:approve') THEN RAISE EXCEPTION 'reviewed customer amendment required' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM customer_amendment_requests WHERE company_id=p_old.company_id AND customer_id=p_old.id AND expected_version=p_old.version AND state='APPLIED';
 IF NOT FOUND OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() OR r.before_snapshot IS DISTINCT FROM customer_row_snapshot(p_old) OR customer_row_snapshot(p_new) IS DISTINCT FROM customer_amendment_after(r) THEN RAISE EXCEPTION 'customer update must exactly match current independent amendment' USING ERRCODE='23514'; END IF;
 PERFORM customer_amendment_validate(r,'customers:credit:approve',false);
END $$;
CREATE FUNCTION customer_amendment_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text;after_value jsonb;prior jsonb;
BEGIN
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'CUSTOMER_AMEND_PROPOSE' WHEN 'APPLIED' THEN 'CUSTOMER_AMEND_APPROVE' ELSE 'CUSTOMER_AMEND_REJECT' END;
 prior=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD)||jsonb_build_object('credit_limit',OLD.credit_limit::text) END;
 after_value=CASE WHEN NEW.state='APPLIED' THEN customer_amendment_after(NEW) ELSE 'null'::jsonb END;
 IF NEW.state='APPLIED' AND customer_current_snapshot(NEW.customer_id) IS DISTINCT FROM after_value THEN RAISE EXCEPTION 'customer amendment must atomically update exact master' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='CUSTOMER_AMENDMENT' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=action_name AND a.reason=current_setting('app.reason',true) AND a.new_values=jsonb_build_object('requestBefore',prior,'requestAfter',customer_amendment_snapshot(NEW.id),'before',NEW.before_snapshot,'after',after_value)) THEN RAISE EXCEPTION 'exact atomic customer amendment audit required' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_amendment_audited AFTER INSERT OR UPDATE ON customer_amendment_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_amendment_audited();
GRANT SELECT,INSERT,UPDATE ON customer_amendment_requests TO erp_runtime;
GRANT UPDATE ON customers TO erp_runtime;
REVOKE DELETE,TRUNCATE ON customer_amendment_requests,customers FROM erp_runtime;
CREATE OR REPLACE FUNCTION customer_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r customer_change_requests%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP='UPDATE' AND (OLD.publication_request_id IS NOT NULL OR current_user='erp_runtime') THEN PERFORM customer_update_guard(OLD,NEW);RETURN NEW; END IF;
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
CREATE CONSTRAINT TRIGGER customer_update_final_guard AFTER UPDATE ON customers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION customer_header_guard();
COMMIT;
