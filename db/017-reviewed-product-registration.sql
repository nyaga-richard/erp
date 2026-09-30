-- Reviewed initial product registration; no inventory/accounting posting.
BEGIN;
INSERT INTO permissions(code,description) VALUES('products:propose','Propose initial product registration'),('products:approve','Independently review product registration'),('products:cost:view','Read product purchase costs; required to approve initial prices') ON CONFLICT DO NOTHING;
CREATE TABLE product_change_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),new_product_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),new_profile_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 sku text NOT NULL CHECK(sku ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'),product_code text NOT NULL CHECK(product_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'),name text NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 160),description text CHECK(length(description)<=1000),item_type text NOT NULL CHECK(item_type IN ('STOCK','SERVICE','NON_STOCK')),
 category_id uuid NOT NULL,brand_id uuid,uom_id uuid NOT NULL,tax_category_id uuid NOT NULL,currency char(3) NOT NULL REFERENCES currencies(code),purchase_price unit_amount NOT NULL CHECK(purchase_price>=0),selling_price unit_amount NOT NULL CHECK(selling_price>=0),price_mode text NOT NULL CHECK(price_mode IN ('INCLUSIVE','EXCLUSIVE')),
 valid_from date NOT NULL CHECK(valid_from BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),valid_to date NOT NULL CHECK(valid_to BETWEEN valid_from AND DATE '9999-12-31'),reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 5 AND 500),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','REJECTED')),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,review_reason text,
 UNIQUE(company_id,id),FOREIGN KEY(company_id,category_id) REFERENCES product_categories(company_id,id),FOREIGN KEY(company_id,brand_id) REFERENCES brands(company_id,id),FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_reason IS NULL) OR (state IN ('APPLIED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason)) BETWEEN 5 AND 500))
);
CREATE TABLE product_request_barcodes(company_id uuid NOT NULL,request_id uuid NOT NULL,barcode text NOT NULL CHECK(length(barcode) BETWEEN 1 AND 128 AND barcode ~ '^[!-~]+$'),PRIMARY KEY(company_id,request_id,barcode),FOREIGN KEY(company_id,request_id) REFERENCES product_change_requests(company_id,id));
CREATE TABLE product_request_taxes(company_id uuid NOT NULL,request_id uuid NOT NULL,tax_id uuid NOT NULL,PRIMARY KEY(company_id,request_id,tax_id),FOREIGN KEY(company_id,request_id) REFERENCES product_change_requests(company_id,id),FOREIGN KEY(company_id,tax_id) REFERENCES taxes(company_id,id));
ALTER TABLE products ADD COLUMN publication_request_id uuid UNIQUE,ADD COLUMN approved_by uuid REFERENCES users(id),ADD COLUMN approved_at timestamptz,ADD COLUMN currency char(3) REFERENCES currencies(code),ADD COLUMN price_mode text CHECK(price_mode IN ('INCLUSIVE','EXCLUSIVE'));
ALTER TABLE products ADD FOREIGN KEY(company_id,publication_request_id) REFERENCES product_change_requests(company_id,id);
CREATE TABLE product_tax_profiles(
 id uuid PRIMARY KEY,company_id uuid NOT NULL REFERENCES companies(id),product_id uuid NOT NULL,tax_category_id uuid NOT NULL,valid_from date NOT NULL,valid_to date NOT NULL,request_id uuid NOT NULL UNIQUE,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),approved_by uuid NOT NULL REFERENCES users(id),approved_at timestamptz NOT NULL,
 UNIQUE(company_id,id),FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),FOREIGN KEY(company_id,tax_category_id) REFERENCES tax_categories(company_id,id),FOREIGN KEY(company_id,request_id) REFERENCES product_change_requests(company_id,id),CHECK(valid_to>=valid_from),CHECK(created_by<>approved_by),EXCLUDE USING gist(company_id WITH =,product_id WITH =,daterange(valid_from,valid_to,'[]') WITH &&)
);
ALTER TABLE product_taxes ADD COLUMN profile_id uuid,ADD FOREIGN KEY(company_id,profile_id) REFERENCES product_tax_profiles(company_id,id);
CREATE UNIQUE INDEX product_profile_tax_unique ON product_taxes(company_id,profile_id,tax_id) WHERE profile_id IS NOT NULL;
CREATE INDEX product_request_queue ON product_change_requests(company_id,state,created_at DESC,id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['product_change_requests','product_request_barcodes','product_request_taxes','product_tax_profiles'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_isolation ON %I USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid())',t);
END LOOP; END $$;
CREATE FUNCTION product_request_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT to_jsonb(r)||jsonb_build_object('barcodes',coalesce((SELECT jsonb_agg(barcode ORDER BY barcode) FROM product_request_barcodes WHERE request_id=r.id),'[]'::jsonb),'tax_ids',coalesce((SELECT jsonb_agg(tax_id ORDER BY tax_id) FROM product_request_taxes WHERE request_id=r.id),'[]'::jsonb)) FROM product_change_requests r WHERE r.id=p_id
$$;
CREATE FUNCTION product_publication_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT to_jsonb(p)||jsonb_build_object('barcodes',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.barcode) FROM product_barcodes b WHERE b.company_id=p.company_id AND b.product_id=p.id),'[]'::jsonb),'profiles',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM product_tax_profiles f WHERE f.company_id=p.company_id AND f.product_id=p.id),'[]'::jsonb),'taxes',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.tax_id) FROM product_taxes t WHERE t.company_id=p.company_id AND t.product_id=p.id),'[]'::jsonb)) FROM products p WHERE p.publication_request_id=p_id
$$;
CREATE FUNCTION assert_product_request(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r product_change_requests%ROWTYPE;cls text;t record;v record;n integer;coverage datemultirange;
BEGIN
 SELECT * INTO r FROM product_change_requests WHERE id=p_id;IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_REQUEST_MISSING' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM product_categories WHERE company_id=r.company_id AND id=r.category_id AND catalog_version=1) OR NOT EXISTS(SELECT 1 FROM units_of_measure WHERE company_id=r.company_id AND id=r.uom_id AND catalog_version=1) OR (r.brand_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM brands WHERE company_id=r.company_id AND id=r.brand_id AND catalog_version=1)) OR NOT EXISTS(SELECT 1 FROM companies WHERE id=r.company_id AND base_currency=r.currency) THEN RAISE EXCEPTION 'PRODUCT_REFERENCES' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM products WHERE company_id=r.company_id AND id<>r.new_product_id AND (sku=r.sku OR product_code=r.product_code)) OR EXISTS(SELECT 1 FROM product_request_barcodes rb JOIN product_barcodes b ON b.company_id=rb.company_id AND b.barcode=rb.barcode WHERE rb.request_id=r.id AND b.product_id<>r.new_product_id) THEN RAISE EXCEPTION 'PRODUCT_IDENTITY' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM product_request_barcodes WHERE request_id=r.id)>20 THEN RAISE EXCEPTION 'PRODUCT_BARCODES' USING ERRCODE='23514'; END IF;
 SELECT classification INTO cls FROM tax_categories WHERE company_id=r.company_id AND id=r.tax_category_id AND publication_request_id IS NOT NULL;
 SELECT count(*) INTO n FROM product_request_taxes WHERE request_id=r.id;
 IF cls IS NULL OR n>10 OR ((cls IN ('TAXABLE','ZERO_RATED')) IS DISTINCT FROM (n>0)) OR (cls IN ('EXEMPT','NON_TAXABLE') AND r.price_mode<>'EXCLUSIVE') THEN RAISE EXCEPTION 'PRODUCT_TAX_PROFILE' USING ERRCODE='23514'; END IF;
 FOR t IN SELECT tax_id FROM product_request_taxes WHERE request_id=r.id LOOP
  IF NOT EXISTS(SELECT 1 FROM taxes WHERE company_id=r.company_id AND id=t.tax_id AND active AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'PRODUCT_TAX_PROFILE' USING ERRCODE='23514'; END IF;
  SELECT range_agg(daterange(valid_from,valid_to,'[]')) INTO coverage FROM tax_rates WHERE company_id=r.company_id AND tax_id=t.tax_id AND category_id=r.tax_category_id AND publication_request_id IS NOT NULL AND inclusive=(r.price_mode='INCLUSIVE');
  IF NOT coalesce(daterange(r.valid_from,r.valid_to,'[]') <@ coverage,false) THEN RAISE EXCEPTION 'PRODUCT_TAX_COVERAGE' USING ERRCODE='23514'; END IF;
  FOR v IN SELECT publication_request_id FROM tax_rates WHERE company_id=r.company_id AND tax_id=t.tax_id AND category_id=r.tax_category_id AND valid_from<=r.valid_to AND valid_to>=r.valid_from AND publication_request_id IS NOT NULL LOOP PERFORM assert_tax_request(v.publication_request_id); END LOOP;
 END LOOP;
END $$;
CREATE FUNCTION product_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'product requests immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'product context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('products:propose') OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.state<>'PENDING' THEN RAISE EXCEPTION 'product proposal authority required' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT account_configuration_allowed('products:approve') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('APPLIED','REJECTED') OR NEW.reviewed_by IS DISTINCT FROM actor_uuid() OR NEW.reviewed_at IS DISTINCT FROM now() OR NEW.reviewed_by=NEW.created_by THEN RAISE EXCEPTION 'independent product review required' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','reviewed_by','reviewed_at','review_reason']) THEN RAISE EXCEPTION 'product proposal payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.state='APPLIED' THEN
   IF NOT account_configuration_allowed('products:cost:view') THEN RAISE EXCEPTION 'product cost review permission required' USING ERRCODE='42501'; END IF;
   PERFORM assert_product_request(NEW.id);
  END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER product_request_guard BEFORE INSERT OR UPDATE OR DELETE ON product_change_requests FOR EACH ROW EXECUTE FUNCTION product_request_guard();
CREATE FUNCTION product_request_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r product_change_requests%ROWTYPE;
BEGIN
 SELECT * INTO r FROM product_change_requests WHERE company_id=NEW.company_id AND id=NEW.request_id;
 IF NOT FOUND OR r.state<>'PENDING' OR r.created_by IS DISTINCT FROM actor_uuid() OR r.created_at<>now() OR NOT account_configuration_allowed('products:propose') THEN RAISE EXCEPTION 'product proposal children require current authorized creation' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER product_barcode_request_guard BEFORE INSERT ON product_request_barcodes FOR EACH ROW EXECUTE FUNCTION product_request_child_guard();
CREATE TRIGGER product_tax_request_guard BEFORE INSERT ON product_request_taxes FOR EACH ROW EXECUTE FUNCTION product_request_child_guard();
CREATE TRIGGER product_barcode_request_immutable BEFORE UPDATE OR DELETE ON product_request_barcodes FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER product_tax_request_immutable BEFORE UPDATE OR DELETE ON product_request_taxes FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION product_header_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r product_change_requests%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF OLD.publication_request_id IS NOT NULL OR current_user='erp_runtime' THEN RAISE EXCEPTION 'governed product immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 IF current_user<>'erp_runtime' AND NEW.publication_request_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM product_change_requests WHERE company_id=NEW.company_id AND id=NEW.publication_request_id AND state='APPLIED';
 IF NOT FOUND OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('products:approve') OR NOT account_configuration_allowed('products:cost:view') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'product requires current independent review' USING ERRCODE='23514'; END IF;
 expected=jsonb_build_object('id',r.new_product_id,'company_id',r.company_id,'created_by',r.created_by,'created_at',now(),'sku',r.sku,'product_code',r.product_code,'name',r.name,'description',r.description,'item_type',r.item_type,'serialized',false,'batch_controlled',false,'expiry_controlled',false,'purchase_price',r.purchase_price,'selling_price',r.selling_price,'reorder_level',0,'min_stock',0,'max_stock',NULL,'active',true,'category_id',r.category_id,'brand_id',r.brand_id,'uom_id',r.uom_id,'supplier_id',NULL,'tax_category_id',r.tax_category_id,'publication_request_id',r.id,'approved_by',r.reviewed_by,'approved_at',r.reviewed_at,'currency',r.currency,'price_mode',r.price_mode);
 IF to_jsonb(NEW) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'product must exactly match approved payload' USING ERRCODE='23514'; END IF;
 PERFORM assert_product_request(r.id);RETURN NEW;
END $$;
CREATE TRIGGER product_header_guard BEFORE INSERT OR UPDATE OR DELETE ON products FOR EACH ROW EXECUTE FUNCTION product_header_guard();
CREATE FUNCTION product_published_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p products%ROWTYPE;r product_change_requests%ROWTYPE;expected jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF current_user='erp_runtime' OR EXISTS(SELECT 1 FROM products WHERE id=OLD.product_id AND publication_request_id IS NOT NULL) THEN RAISE EXCEPTION 'governed product children immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END IF;
 SELECT * INTO p FROM products WHERE company_id=NEW.company_id AND id=NEW.product_id;
 IF current_user<>'erp_runtime' AND p.publication_request_id IS NULL AND TG_TABLE_NAME<>'product_tax_profiles' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM product_change_requests WHERE id=p.publication_request_id AND state='APPLIED';
 IF NOT FOUND OR NEW.company_id IS DISTINCT FROM company_uuid() OR NOT account_configuration_allowed('products:approve') OR NOT account_configuration_allowed('products:cost:view') OR r.reviewed_by IS DISTINCT FROM actor_uuid() OR r.reviewed_at IS DISTINCT FROM now() OR NEW.created_by IS DISTINCT FROM r.created_by OR NEW.created_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'product children require current publication' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='product_barcodes' THEN
  IF NEW.uom_id<>r.uom_id OR NOT EXISTS(SELECT 1 FROM product_request_barcodes WHERE request_id=r.id AND barcode=NEW.barcode) THEN RAISE EXCEPTION 'barcode must match reviewed base unit binding' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='product_taxes' THEN
  IF (NEW.profile_id,NEW.valid_from,NEW.valid_to) IS DISTINCT FROM (r.new_profile_id,r.valid_from,r.valid_to) OR NOT EXISTS(SELECT 1 FROM product_request_taxes WHERE request_id=r.id AND tax_id=NEW.tax_id) THEN RAISE EXCEPTION 'tax binding must match reviewed profile' USING ERRCODE='23514'; END IF;
 ELSE
  expected=jsonb_build_object('id',r.new_profile_id,'company_id',r.company_id,'product_id',r.new_product_id,'tax_category_id',r.tax_category_id,'valid_from',r.valid_from,'valid_to',r.valid_to,'request_id',r.id,'created_by',r.created_by,'created_at',now(),'approved_by',r.reviewed_by,'approved_at',r.reviewed_at);
  IF to_jsonb(NEW) IS DISTINCT FROM expected THEN RAISE EXCEPTION 'dated profile must match reviewed request' USING ERRCODE='23514'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER governed_barcode_guard BEFORE INSERT OR UPDATE OR DELETE ON product_barcodes FOR EACH ROW EXECUTE FUNCTION product_published_child_guard();
CREATE TRIGGER governed_product_tax_guard BEFORE INSERT OR UPDATE OR DELETE ON product_taxes FOR EACH ROW EXECUTE FUNCTION product_published_child_guard();
CREATE TRIGGER governed_product_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON product_tax_profiles FOR EACH ROW EXECUTE FUNCTION product_published_child_guard();
CREATE FUNCTION product_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_value jsonb;after_value jsonb;published jsonb;action_name text;
BEGIN
 before_value=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD)||jsonb_build_object('barcodes',coalesce((SELECT jsonb_agg(barcode ORDER BY barcode) FROM product_request_barcodes WHERE request_id=NEW.id),'[]'::jsonb),'tax_ids',coalesce((SELECT jsonb_agg(tax_id ORDER BY tax_id) FROM product_request_taxes WHERE request_id=NEW.id),'[]'::jsonb)) END;
 after_value=product_request_snapshot(NEW.id);published=coalesce(product_publication_snapshot(NEW.id),'null'::jsonb);
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'PRODUCT_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'PRODUCT_CHANGE_APPROVE' ELSE 'PRODUCT_CHANGE_REJECT' END;
 IF NEW.state IN ('PENDING','APPLIED') THEN PERFORM assert_product_request(NEW.id); END IF;
 IF NEW.state='APPLIED' THEN
  IF published='null'::jsonb OR jsonb_array_length(published->'barcodes')<>(SELECT count(*) FROM product_request_barcodes WHERE request_id=NEW.id) OR jsonb_array_length(published->'taxes')<>(SELECT count(*) FROM product_request_taxes WHERE request_id=NEW.id) OR jsonb_array_length(published->'profiles')<>1 THEN RAISE EXCEPTION 'product publication requires complete atomic children' USING ERRCODE='23514'; END IF;
 ELSIF published<>'null'::jsonb THEN RAISE EXCEPTION 'unapproved product publication forbidden' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='PRODUCT_CONFIGURATION' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=action_name AND a.new_values=jsonb_build_object('before',before_value,'after',after_value,'published',published)) THEN RAISE EXCEPTION 'exact atomic product audit required' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_request_audited AFTER INSERT OR UPDATE ON product_change_requests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_request_audited();
REVOKE ALL ON product_change_requests,product_request_barcodes,product_request_taxes,product_tax_profiles FROM PUBLIC,erp_runtime,erp_auth_worker;
GRANT SELECT,INSERT ON product_change_requests,product_request_barcodes,product_request_taxes,product_tax_profiles TO erp_runtime;
GRANT UPDATE(state,reviewed_by,reviewed_at,review_reason) ON product_change_requests TO erp_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON products,product_barcodes,product_taxes FROM erp_runtime;
GRANT SELECT,INSERT ON products,product_barcodes,product_taxes TO erp_runtime;
COMMIT;
