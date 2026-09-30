-- Independently reviewed tax masters and finite effective schedules. No operational tax posting.
BEGIN;
INSERT INTO permissions(code,description) VALUES('taxes:view','Read reviewed tax configuration and informational previews'),('taxes:propose','Propose tax masters and finite schedules'),('taxes:approve','Independently review tax configuration') ON CONFLICT DO NOTHING;
CREATE TABLE tax_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), kind text NOT NULL CHECK(kind IN ('TAX','CATEGORY','RATE')),
 record_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), code text, name text, tax_type text, classification text,
 tax_id uuid, category_id uuid, valid_from date, valid_to date, rate rate_amount, inclusive boolean, recoverable_fraction rate_amount, input_account_id uuid, output_account_id uuid,
 basis text NOT NULL CHECK(length(trim(basis)) BETWEEN 5 AND 1000), reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, review_reason text,
 UNIQUE(company_id,id), FOREIGN KEY(company_id,tax_id) REFERENCES taxes(company_id,id), FOREIGN KEY(company_id,category_id) REFERENCES tax_categories(company_id,id),
 FOREIGN KEY(company_id,input_account_id) REFERENCES accounts(company_id,id), FOREIGN KEY(company_id,output_account_id) REFERENCES accounts(company_id,id),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (state IN ('APPLIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500)),
 CHECK((kind IN ('TAX','CATEGORY') AND code IS NOT NULL AND code ~ '^[A-Z][A-Z0-9_]{1,31}$' AND name IS NOT NULL AND length(trim(name)) BETWEEN 2 AND 120 AND num_nonnulls(tax_id,category_id,valid_from,valid_to,rate,inclusive,recoverable_fraction,input_account_id,output_account_id)=0 AND ((kind='TAX' AND tax_type IS NOT NULL AND tax_type IN ('VAT','EXCISE','LEVY','OTHER') AND classification IS NULL) OR (kind='CATEGORY' AND classification IS NOT NULL AND classification IN ('TAXABLE','ZERO_RATED','EXEMPT','NON_TAXABLE') AND tax_type IS NULL))) OR
 (kind='RATE' AND num_nonnulls(code,name,tax_type,classification)=0 AND num_nonnulls(tax_id,category_id,valid_from,valid_to,rate,inclusive,recoverable_fraction,input_account_id,output_account_id)=9 AND valid_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31' AND valid_to BETWEEN valid_from AND DATE '9999-12-31' AND rate BETWEEN 0 AND 100 AND recoverable_fraction BETWEEN 0 AND 1))
);
ALTER TABLE tax_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON tax_change_requests USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
CREATE INDEX tax_change_queue ON tax_change_requests(company_id,state,created_at DESC,id);
ALTER TABLE taxes ADD COLUMN publication_request_id uuid UNIQUE, ADD COLUMN approved_by uuid REFERENCES users(id), ADD COLUMN approved_at timestamptz;
ALTER TABLE tax_categories ADD COLUMN publication_request_id uuid UNIQUE, ADD COLUMN approved_by uuid REFERENCES users(id), ADD COLUMN approved_at timestamptz;
ALTER TABLE tax_rates ADD COLUMN publication_request_id uuid UNIQUE, ADD COLUMN approved_by uuid REFERENCES users(id), ADD COLUMN approved_at timestamptz;
ALTER TABLE taxes ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES tax_change_requests(company_id,id);
ALTER TABLE tax_categories ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES tax_change_requests(company_id,id);
ALTER TABLE tax_rates ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES tax_change_requests(company_id,id);
CREATE FUNCTION tax_publication_snapshot(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE r tax_change_requests%ROWTYPE; result jsonb;
BEGIN
 SELECT * INTO r FROM tax_change_requests WHERE id=p_id;
 IF r.kind='TAX' THEN SELECT to_jsonb(t) INTO result FROM taxes t WHERE id=r.record_id AND publication_request_id=r.id;
 ELSIF r.kind='CATEGORY' THEN SELECT to_jsonb(t) INTO result FROM tax_categories t WHERE id=r.record_id AND publication_request_id=r.id;
 ELSE SELECT to_jsonb(t) INTO result FROM tax_rates t WHERE id=r.record_id AND publication_request_id=r.id; END IF;
 RETURN coalesce(result,'null'::jsonb);
END $$;
CREATE FUNCTION assert_tax_request(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r tax_change_requests%ROWTYPE; cls text;
BEGIN
 SELECT * INTO r FROM tax_change_requests WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TAX_REQUEST_MISSING' USING ERRCODE='23514'; END IF;
 IF r.kind='TAX' THEN
  IF EXISTS(SELECT 1 FROM taxes WHERE company_id=r.company_id AND code=r.code AND id<>r.record_id) THEN RAISE EXCEPTION 'TAX_DUPLICATE' USING ERRCODE='23514'; END IF;
 ELSIF r.kind='CATEGORY' THEN
  IF EXISTS(SELECT 1 FROM tax_categories WHERE company_id=r.company_id AND code=r.code AND id<>r.record_id) THEN RAISE EXCEPTION 'TAX_DUPLICATE' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT classification INTO cls FROM tax_categories WHERE company_id=r.company_id AND id=r.category_id AND publication_request_id IS NOT NULL;
  IF cls IS NULL OR cls NOT IN ('TAXABLE','ZERO_RATED') OR (cls='TAXABLE' AND r.rate<=0) OR (cls='ZERO_RATED' AND r.rate<>0) OR NOT EXISTS(SELECT 1 FROM taxes WHERE company_id=r.company_id AND id=r.tax_id AND active AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'TAX_CLASSIFICATION' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounts a JOIN companies co ON co.id=a.company_id WHERE a.company_id=r.company_id AND a.id=r.input_account_id AND a.active AND a.postable AND a.account_type='ASSET' AND a.control_type='TAX' AND (a.currency IS NULL OR a.currency=co.base_currency)) OR NOT EXISTS(SELECT 1 FROM accounts a JOIN companies co ON co.id=a.company_id WHERE a.company_id=r.company_id AND a.id=r.output_account_id AND a.active AND a.postable AND a.account_type='LIABILITY' AND a.control_type='TAX' AND (a.currency IS NULL OR a.currency=co.base_currency)) THEN RAISE EXCEPTION 'TAX_ACCOUNTS' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM tax_rates WHERE company_id=r.company_id AND tax_id=r.tax_id AND category_id=r.category_id AND id<>r.record_id AND valid_from<=r.valid_to AND valid_to>=r.valid_from) THEN RAISE EXCEPTION 'TAX_OVERLAP' USING ERRCODE='23514'; END IF;
 END IF;
END $$;
CREATE FUNCTION tax_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'tax requests immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'tax context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('taxes:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' THEN RAISE EXCEPTION 'tax proposal authority required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT account_configuration_allowed('taxes:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by THEN RAISE EXCEPTION 'independent tax review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) THEN RAISE EXCEPTION 'tax proposal payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state='APPLIED' THEN PERFORM assert_tax_request(NEW.id); END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_request_guard BEFORE INSERT OR UPDATE OR DELETE ON tax_change_requests FOR EACH ROW EXECUTE FUNCTION tax_request_guard();
CREATE FUNCTION tax_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r tax_change_requests%ROWTYPE; expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.publication_request_id IS NOT NULL OR current_user='erp_runtime' THEN RAISE EXCEPTION 'published tax configuration immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 -- Legacy/migration-owned rows are not implicitly approved and are excluded from the new resolver.
 IF current_user<>'erp_runtime' AND NEW.publication_request_id IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 SELECT * INTO r FROM tax_change_requests WHERE id=NEW.publication_request_id AND company_id=NEW.company_id AND state='APPLIED';
 IF NOT FOUND OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('taxes:approve') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'tax publication requires independent current review' USING ERRCODE='23514'; END IF;
 expected=jsonb_build_object('id',r.record_id,'company_id',r.company_id,'created_by',r.created_by,'created_at',now(),'publication_request_id',r.id,'approved_by',r.reviewed_by,'approved_at',r.reviewed_at);
 IF TG_TABLE_NAME='taxes' AND r.kind='TAX' THEN expected=expected||jsonb_build_object('code',r.code,'name',r.name,'tax_type',r.tax_type,'active',true);
 ELSIF TG_TABLE_NAME='tax_categories' AND r.kind='CATEGORY' THEN expected=expected||jsonb_build_object('code',r.code,'name',r.name,'classification',r.classification);
 ELSIF TG_TABLE_NAME='tax_rates' AND r.kind='RATE' THEN expected=expected||jsonb_build_object('tax_id',r.tax_id,'category_id',r.category_id,'valid_from',r.valid_from,'valid_to',r.valid_to,'rate',r.rate,'inclusive',r.inclusive,'recoverable_fraction',r.recoverable_fraction,'input_account_id',r.input_account_id,'output_account_id',r.output_account_id,'priority',0);
 ELSE RAISE EXCEPTION 'tax publication kind mismatch' USING ERRCODE='23514'; END IF;
 IF to_jsonb(NEW) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'tax publication must exactly match approved request' USING ERRCODE='23514'; END IF;
 PERFORM assert_tax_request(r.id);RETURN NEW;
END $$;
CREATE TRIGGER tax_master_guard BEFORE INSERT OR UPDATE OR DELETE ON taxes FOR EACH ROW EXECUTE FUNCTION tax_publication_guard();
CREATE TRIGGER tax_category_guard BEFORE INSERT OR UPDATE OR DELETE ON tax_categories FOR EACH ROW EXECUTE FUNCTION tax_publication_guard();
CREATE TRIGGER tax_rate_guard BEFORE INSERT OR UPDATE OR DELETE ON tax_rates FOR EACH ROW EXECUTE FUNCTION tax_publication_guard();
CREATE FUNCTION tax_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb; after_value jsonb; published jsonb; action_name text;
BEGIN
 before_value=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD) END;
 SELECT to_jsonb(r) INTO after_value FROM tax_change_requests r WHERE id=NEW.id;
 published=tax_publication_snapshot(NEW.id);
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'TAX_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'TAX_CHANGE_APPROVE' ELSE 'TAX_CHANGE_REJECT' END;
 IF NEW.state IN ('PENDING','APPLIED') THEN PERFORM assert_tax_request(NEW.id); END IF;
 IF (NEW.state='APPLIED') IS DISTINCT FROM (published<>'null'::jsonb) THEN RAISE EXCEPTION 'tax publication must be atomic with decision' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='TAX_CONFIGURATION' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=action_name AND a.new_values=jsonb_build_object('before',before_value,'after',after_value,'published',published)) THEN RAISE EXCEPTION 'tax configuration requires exact atomic audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER tax_request_audited AFTER INSERT OR UPDATE ON tax_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tax_request_audited();
REVOKE ALL ON tax_change_requests FROM PUBLIC,erp_runtime,erp_auth_worker;
GRANT SELECT,INSERT ON tax_change_requests TO erp_runtime;
GRANT UPDATE(state,reviewed_by,reviewed_at,review_reason) ON tax_change_requests TO erp_runtime;
-- Existing exclusion on tax_rates remains the independent database concurrency backstop.
REVOKE UPDATE,DELETE,TRUNCATE ON taxes,tax_categories,tax_rates FROM erp_runtime;
GRANT SELECT,INSERT ON taxes,tax_categories,tax_rates TO erp_runtime;
COMMIT;
