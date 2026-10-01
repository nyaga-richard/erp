BEGIN;

-- Typed immutable valuation snapshot for a submitted service-credit invoice.
-- This migration still does not create sale/AR/tax/journal effects.
CREATE TABLE customer_invoice_valuations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL,
 source_id uuid NOT NULL,
 source_revision integer NOT NULL CHECK(source_revision>0),
 warehouse_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 customer_number text NOT NULL,
 customer_name text NOT NULL,
 customer_version integer NOT NULL CHECK(customer_version>0),
 customer_credit_limit money_amount NOT NULL CHECK(customer_credit_limit>=0),
 customer_credit_hold boolean NOT NULL,
 customer_payment_terms_days integer NOT NULL CHECK(customer_payment_terms_days BETWEEN 0 AND 3650),
 control_account_id uuid NOT NULL,
 product_id uuid NOT NULL,
 product_sku text NOT NULL,
 product_code text NOT NULL,
 product_name text NOT NULL,
 product_category_id uuid NOT NULL,
 product_brand_id uuid,
 uom_id uuid NOT NULL,
 product_profile_id uuid NOT NULL,
 quantity_scale smallint NOT NULL CHECK(quantity_scale BETWEEN 0 AND 6),
 quantity quantity_amount NOT NULL CHECK(quantity>0),
 unit_price unit_amount NOT NULL CHECK(unit_price>=0),
 discount money_amount NOT NULL DEFAULT 0 CHECK(discount=0),
 price_mode text NOT NULL CHECK(price_mode IN ('INCLUSIVE','EXCLUSIVE')),
 net money_amount NOT NULL CHECK(net>0),
 tax money_amount NOT NULL CHECK(tax>=0),
 gross money_amount NOT NULL CHECK(gross>0),
 currency char(3) NOT NULL REFERENCES currencies(code),
 due_date date NOT NULL,
 tax_snapshot jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,source_id,source_revision),
 FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),
 FOREIGN KEY(company_id,customer_id) REFERENCES customers(company_id,id),
 FOREIGN KEY(company_id,control_account_id) REFERENCES accounts(company_id,id),
 FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id),
 FOREIGN KEY(company_id,product_category_id) REFERENCES product_categories(company_id,id),
 FOREIGN KEY(company_id,product_brand_id) REFERENCES brands(company_id,id),
 FOREIGN KEY(company_id,uom_id) REFERENCES units_of_measure(company_id,id),
 FOREIGN KEY(company_id,product_profile_id) REFERENCES product_tax_profiles(company_id,id),
 CHECK(net+tax=gross)
);
ALTER TABLE customer_invoice_valuations ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON customer_invoice_valuations USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid());
GRANT SELECT,INSERT ON customer_invoice_valuations TO erp_runtime;
REVOKE UPDATE,DELETE,TRUNCATE ON customer_invoice_valuations FROM erp_runtime;

CREATE FUNCTION service_invoice_valuation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;cu customers%ROWTYPE;ca customer_accounts%ROWTYPE;a accounts%ROWTYPE;co companies%ROWTYPE;
 p products%ROWTYPE;u units_of_measure%ROWTYPE;f product_tax_profiles%ROWTYPE;tc tax_categories%ROWTYPE;period_row financial_periods%ROWTYPE;
 item jsonb;rate_row tax_rates%ROWTYPE;rate_count integer;profile_tax_count integer;component_count integer;
 classification text;sum_rate numeric:=0;inclusive boolean:=false;has_inclusive boolean:=false;
extension numeric;discounted numeric;raw_net numeric;net_value numeric;tax_value numeric;gross_value numeric;extra_cents integer:=0;
 expected_components jsonb;price_format text:='FM9999999999999999990.00';
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'submitted valuation snapshots are immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.company_id::text,77));
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NOT account_configuration_allowed('customer-invoices:submit') THEN RAISE EXCEPTION 'invoice valuation authority required' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM source_documents WHERE company_id=NEW.company_id AND id=NEW.source_id FOR UPDATE;
 IF NOT FOUND OR s.document_type<>'SERVICE_CREDIT_INVOICE' OR s.status<>'DRAFT' OR s.created_by IS DISTINCT FROM actor_uuid() OR s.revision<>NEW.source_revision OR s.business_date IS NULL OR s.currency<>NEW.currency OR s.original_document_id IS NOT NULL OR s.initiated_by IS DISTINCT FROM s.created_by THEN RAISE EXCEPTION 'valuation requires its own current invoice draft' USING ERRCODE='23514'; END IF;
 SELECT * INTO period_row FROM financial_periods WHERE company_id=NEW.company_id AND s.business_date BETWEEN starts_on AND ends_on AND status='OPEN' FOR SHARE;
 IF period_row.id IS NULL THEN RAISE EXCEPTION 'invoice business date must be in an open locked financial period' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(s.payload))<>4 OR s.payload IS DISTINCT FROM jsonb_build_object('warehouseId',NEW.warehouse_id::text,'customerId',NEW.customer_id::text,'productId',NEW.product_id::text,'quantity',NEW.quantity::numeric::text) THEN RAISE EXCEPTION 'valuation must match the strict invoice draft inputs' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM warehouses w WHERE w.company_id=NEW.company_id AND w.id=NEW.warehouse_id AND w.branch_id=s.branch_id AND w.active AND w.location_type='SELLABLE') OR NOT EXISTS(SELECT 1 FROM user_branch_scopes b WHERE b.company_id=NEW.company_id AND b.user_id=actor_uuid() AND b.branch_id=s.branch_id) THEN RAISE EXCEPTION 'active sellable warehouse and assigned branch required' USING ERRCODE='23514'; END IF;
 SELECT * INTO cu FROM customers WHERE company_id=NEW.company_id AND id=NEW.customer_id FOR SHARE;
 SELECT * INTO ca FROM customer_accounts WHERE company_id=NEW.company_id AND customer_id=NEW.customer_id;
 SELECT * INTO a FROM accounts WHERE company_id=NEW.company_id AND id=ca.control_account_id FOR SHARE;
 SELECT * INTO co FROM companies WHERE id=NEW.company_id;
 IF cu.id IS NULL OR cu.publication_request_id IS NULL OR cu.customer_type<>'REGISTERED' OR NOT cu.active OR cu.credit_hold OR cu.credit_limit<=0 OR cu.currency<>co.base_currency OR cu.currency<>NEW.currency OR (cu.number,cu.name,cu.version,cu.credit_limit,cu.credit_hold,cu.payment_terms_days) IS DISTINCT FROM (NEW.customer_number,NEW.customer_name,NEW.customer_version,NEW.customer_credit_limit,NEW.customer_credit_hold,NEW.customer_payment_terms_days) THEN RAISE EXCEPTION 'customer identity and policy snapshot must match the current governed customer' USING ERRCODE='23514'; END IF;
 IF ca.id IS NULL OR a.id IS NULL OR ca.control_account_id IS DISTINCT FROM NEW.control_account_id OR a.account_type<>'ASSET' OR a.control_type IS DISTINCT FROM 'AR' OR NOT a.active OR NOT a.postable OR EXISTS(SELECT 1 FROM accounts child WHERE child.company_id=NEW.company_id AND child.parent_id=a.id) THEN RAISE EXCEPTION 'current active postable AR leaf binding required' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM products WHERE company_id=NEW.company_id AND id=NEW.product_id;
 SELECT * INTO u FROM units_of_measure WHERE company_id=NEW.company_id AND id=p.uom_id;
 SELECT * INTO f FROM product_tax_profiles WHERE company_id=NEW.company_id AND id=NEW.product_profile_id;
 IF p.id IS NULL OR p.publication_request_id IS NULL OR NOT p.active OR p.item_type<>'SERVICE' OR (p.sku,p.product_code,p.name,p.category_id,p.brand_id,p.uom_id,p.selling_price,p.price_mode,p.currency) IS DISTINCT FROM (NEW.product_sku,NEW.product_code,NEW.product_name,NEW.product_category_id,NEW.product_brand_id,NEW.uom_id,NEW.unit_price,NEW.price_mode,NEW.currency) OR u.id IS NULL OR u.quantity_scale<>NEW.quantity_scale OR NEW.quantity::numeric<>trunc(NEW.quantity::numeric,NEW.quantity_scale) OR f.id IS NULL OR f.product_id<>p.id OR f.valid_from>s.business_date OR f.valid_to<s.business_date THEN RAISE EXCEPTION 'product identity, active SERVICE valuation and unit precision snapshot mismatch' USING ERRCODE='23514'; END IF;
 SELECT tc.classification INTO classification FROM tax_categories tc WHERE tc.company_id=NEW.company_id AND tc.id=f.tax_category_id AND tc.publication_request_id IS NOT NULL;
 IF classification IS NULL OR jsonb_typeof(NEW.tax_snapshot)<>'object' OR (NEW.tax_snapshot-ARRAY['engine','version','rounding','inclusiveAllocation','priceMode','input','totals','components'])<>'{}'::jsonb OR NOT(NEW.tax_snapshot ?& ARRAY['engine','version','rounding','inclusiveAllocation','priceMode','input','totals','components']) OR NEW.tax_snapshot->>'engine'<>'SAME_BASE_TAX' OR NEW.tax_snapshot->>'version'<>'1' OR NEW.tax_snapshot->>'rounding'<>'HALF_UP_CURRENCY_2' OR NEW.tax_snapshot->>'inclusiveAllocation'<>'LARGEST_REMAINDER_TAX_ID' OR NEW.tax_snapshot->>'priceMode'<>NEW.price_mode THEN RAISE EXCEPTION 'unsupported or malformed immutable tax snapshot' USING ERRCODE='23514'; END IF;
 IF jsonb_typeof(NEW.tax_snapshot->'input')<>'object' OR (NEW.tax_snapshot->'input'-ARRAY['quantity','unitPrice','discount','currency','scale','date','classification','rates'])<>'{}'::jsonb OR NOT((NEW.tax_snapshot->'input') ?& ARRAY['quantity','unitPrice','discount','currency','scale','date','classification','rates']) OR jsonb_typeof(NEW.tax_snapshot->'input'->'rates')<>'array' THEN RAISE EXCEPTION 'tax input snapshot shape invalid' USING ERRCODE='23514'; END IF;
 IF (NEW.tax_snapshot->'input'->>'quantity')::numeric<>NEW.quantity OR (NEW.tax_snapshot->'input'->>'unitPrice')::numeric<>NEW.unit_price OR (NEW.tax_snapshot->'input'->>'discount')::numeric<>NEW.discount OR NEW.tax_snapshot->'input'->>'currency'<>NEW.currency OR NEW.tax_snapshot->'input'->>'scale'<>'2' OR NEW.tax_snapshot->'input'->>'date'<>to_char(s.business_date,'YYYY-MM-DD') OR NEW.tax_snapshot->'input'->>'classification'<>classification THEN RAISE EXCEPTION 'tax input differs from the typed source valuation' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO profile_tax_count FROM product_taxes WHERE company_id=NEW.company_id AND product_id=NEW.product_id AND profile_id=NEW.product_profile_id;
 rate_count:=jsonb_array_length(NEW.tax_snapshot->'input'->'rates');
 IF rate_count<>profile_tax_count OR rate_count>10 OR (SELECT count(DISTINCT value->>'taxId') FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates'))<>rate_count OR (SELECT count(DISTINCT value->>'rateId') FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates'))<>rate_count OR (SELECT count(DISTINCT value->>'outputAccountId') FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates') WHERE value->>'outputAccountId' IS NOT NULL)>1 THEN RAISE EXCEPTION 'tax input must include every and only tax in the published dated product profile with one canonical output control' USING ERRCODE='23514'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates') LOOP
  IF jsonb_typeof(item)<>'object' OR (item-ARRAY['taxId','rateId','rate','validFrom','validTo','inclusive','recoverableFraction','inputAccountId','outputAccountId'])<>'{}'::jsonb OR NOT(item ?& ARRAY['taxId','rateId','rate','validFrom','validTo','inclusive','recoverableFraction','inputAccountId','outputAccountId']) THEN RAISE EXCEPTION 'tax rate snapshot shape invalid' USING ERRCODE='23514'; END IF;
  SELECT * INTO rate_row FROM tax_rates WHERE company_id=NEW.company_id AND id=(item->>'rateId')::uuid;
  IF rate_row.id IS NULL OR rate_row.tax_id::text<>item->>'taxId' OR rate_row.category_id<>f.tax_category_id OR rate_row.publication_request_id IS NULL OR rate_row.valid_from>s.business_date OR rate_row.valid_to<s.business_date OR NOT EXISTS(SELECT 1 FROM taxes t WHERE t.company_id=NEW.company_id AND t.id=rate_row.tax_id AND t.active AND t.publication_request_id IS NOT NULL) OR NOT EXISTS(SELECT 1 FROM product_taxes pt WHERE pt.company_id=NEW.company_id AND pt.product_id=NEW.product_id AND pt.profile_id=NEW.product_profile_id AND pt.tax_id=rate_row.tax_id) OR rate_row.rate<>(item->>'rate')::numeric OR rate_row.valid_from<>(item->>'validFrom')::date OR rate_row.valid_to<>(item->>'validTo')::date OR rate_row.inclusive<>(item->>'inclusive')::boolean OR rate_row.recoverable_fraction<>(item->>'recoverableFraction')::numeric OR rate_row.input_account_id IS DISTINCT FROM nullif(item->>'inputAccountId','')::uuid OR rate_row.output_account_id IS DISTINCT FROM nullif(item->>'outputAccountId','')::uuid THEN RAISE EXCEPTION 'tax rate snapshot is not the current governed effective rate' USING ERRCODE='23514'; END IF;
  sum_rate:=sum_rate+(item->>'rate')::numeric;
  IF rate_count=1 THEN inclusive:=(item->>'inclusive')::boolean;ELSIF has_inclusive IS FALSE THEN inclusive:=(item->>'inclusive')::boolean;has_inclusive:=true;ELSIF inclusive IS DISTINCT FROM (item->>'inclusive')::boolean THEN RAISE EXCEPTION 'mixed tax price modes unsupported' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF (rate_count>0 AND (inclusive IS DISTINCT FROM (NEW.price_mode='INCLUSIVE'))) OR (classification='TAXABLE' AND (rate_count=0 OR sum_rate<=0)) OR (classification='ZERO_RATED' AND (rate_count=0 OR sum_rate<>0)) OR (classification IN ('EXEMPT','NON_TAXABLE') AND (rate_count<>0 OR NEW.price_mode<>'EXCLUSIVE')) THEN RAISE EXCEPTION 'tax classification/rates/price mode inconsistent' USING ERRCODE='23514'; END IF;
 extension:=round(NEW.quantity*NEW.unit_price,2);discounted:=extension-NEW.discount;
 IF inclusive AND rate_count>0 THEN raw_net:=discounted/(1+sum_rate);net_value:=round(raw_net,2);tax_value:=discounted-net_value;SELECT round((tax_value-coalesce(sum(trunc(raw_net*(value->>'rate')::numeric,2)),0))*100)::integer INTO extra_cents FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates');IF extra_cents<0 OR extra_cents>rate_count THEN RAISE EXCEPTION 'inclusive tax residual allocation invalid' USING ERRCODE='23514'; END IF;
 ELSE raw_net:=discounted;net_value:=discounted;SELECT coalesce(sum(round(raw_net*(value->>'rate')::numeric,2)),0) INTO tax_value FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates');END IF;
 gross_value:=net_value+tax_value;
 IF net_value<>NEW.net OR tax_value<>NEW.tax OR gross_value<>NEW.gross OR NEW.due_date<>s.business_date+cu.payment_terms_days OR jsonb_typeof(NEW.tax_snapshot->'totals')<>'object' OR (NEW.tax_snapshot->'totals'-ARRAY['net','tax','gross'])<>'{}'::jsonb OR NOT((NEW.tax_snapshot->'totals') ?& ARRAY['net','tax','gross']) OR (NEW.tax_snapshot->'totals'->>'net')<>to_char(net_value,price_format) OR (NEW.tax_snapshot->'totals'->>'tax')<>to_char(tax_value,price_format) OR (NEW.tax_snapshot->'totals'->>'gross')<>to_char(gross_value,price_format) OR jsonb_typeof(NEW.tax_snapshot->'components')<>'array' THEN RAISE EXCEPTION 'invoice arithmetic, due date or tax totals mismatch' USING ERRCODE='23514'; END IF;
 WITH rates AS(
  SELECT value->>'taxId' tax_id,value->>'rateId' rate_id,(value->>'rate')::numeric rate,(value->>'recoverableFraction')::numeric recoverable,
    raw_net*(value->>'rate')::numeric raw,
    CASE WHEN inclusive AND rate_count>0 THEN trunc(raw_net*(value->>'rate')::numeric,2) ELSE round(raw_net*(value->>'rate')::numeric,2) END base_tax
  FROM jsonb_array_elements(NEW.tax_snapshot->'input'->'rates')
 ), ranked AS(
  SELECT *,row_number() OVER(ORDER BY raw-trunc(raw,2) DESC,tax_id,rate_id) rn FROM rates
 ), components AS(
  SELECT tax_id,rate_id,CASE WHEN inclusive AND rate_count>0 AND rn<=extra_cents THEN base_tax+0.01 ELSE base_tax END component_tax,recoverable FROM ranked
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('taxId',tax_id,'rateId',rate_id,'tax',to_char(component_tax,price_format),'recoverable',to_char(round(component_tax*recoverable,2),price_format),'nonrecoverable',to_char(component_tax-round(component_tax*recoverable,2),price_format)) ORDER BY tax_id,rate_id),'[]'::jsonb) INTO expected_components FROM components;
 IF NEW.tax_snapshot->'components' IS DISTINCT FROM expected_components THEN RAISE EXCEPTION 'tax component snapshot is not reproducible' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_invoice_valuation_guard BEFORE INSERT OR UPDATE OR DELETE ON customer_invoice_valuations FOR EACH ROW EXECUTE FUNCTION service_invoice_valuation_guard();

CREATE FUNCTION service_invoice_policy_snapshot(p_source uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE s source_documents%ROWTYPE;v customer_invoice_valuations%ROWTYPE;p approval_policies%ROWTYPE;co companies%ROWTYPE;steps jsonb;
BEGIN
 SELECT * INTO s FROM source_documents WHERE id=p_source;
 SELECT * INTO v FROM customer_invoice_valuations WHERE company_id=s.company_id AND source_id=s.id AND source_revision=s.revision;
 IF s.id IS NULL OR v.source_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO co FROM companies WHERE id=s.company_id;
 SELECT * INTO p FROM approval_policies WHERE company_id=s.company_id AND event_type=s.document_type AND branch_id IS NULL AND active AND threshold_base<=v.gross ORDER BY threshold_base DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN jsonb_build_object('origin','COMPANY_BASELINE','policyId',NULL,'version',1,'revision',s.revision,'baseAmount',v.gross::text,'independentCreator',co.independent_approval,'independentPoster',co.independent_posting,'steps',jsonb_build_array(jsonb_build_object('number',1,'permission','customer-invoices:approve','minimumApprovers',1,'stepId',NULL))); END IF;
 SELECT jsonb_agg(jsonb_build_object('stepId',id,'number',step_no,'permission',required_permission,'minimumApprovers',minimum_approvers) ORDER BY step_no) INTO steps FROM approval_steps WHERE company_id=s.company_id AND policy_id=p.id;
 IF coalesce(jsonb_array_length(steps),0)<1 THEN RAISE EXCEPTION 'invoice approval policy has no steps' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('origin','PUBLISHED_POLICY','policyId',p.id,'version',p.version,'revision',s.revision,'baseAmount',v.gross::text,'threshold',p.threshold_base::text,'independentCreator',p.independent_creator,'independentPoster',p.independent_poster,'steps',steps);
END $$;

CREATE FUNCTION service_invoice_valuation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;
BEGIN
 SELECT * INTO s FROM source_documents WHERE company_id=NEW.company_id AND id=NEW.source_id;
 IF s.status<>'PENDING_APPROVAL' OR s.revision<>NEW.source_revision OR s.approval_snapshot IS DISTINCT FROM service_invoice_policy_snapshot(s.id) THEN RAISE EXCEPTION 'invoice valuation must commit with its immutable pending-review source' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER service_invoice_valuation_complete AFTER INSERT ON customer_invoice_valuations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION service_invoice_valuation_complete();

CREATE FUNCTION service_invoice_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
 IF NEW.document_type<>'SERVICE_CREDIT_INVOICE' THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.company_id::text,77));
 IF TG_OP='INSERT' THEN
  IF NOT account_configuration_allowed('customer-invoices:create') OR NEW.company_id IS DISTINCT FROM company_uuid() OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.initiated_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.status<>'DRAFT' OR NEW.revision<>1 OR NEW.approval_snapshot IS NOT NULL OR NEW.updated_by IS NOT NULL OR NEW.updated_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.posted_by IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.cancelled_by IS NOT NULL OR NEW.cancelled_at IS NOT NULL OR NEW.original_document_id IS NOT NULL OR NEW.reversal_reason IS NOT NULL OR NEW.currency<>(SELECT base_currency FROM companies WHERE id=NEW.company_id) OR NEW.exchange_rate<>1 OR NEW.description IS DISTINCT FROM current_setting('app.reason',true) OR (SELECT count(*) FROM jsonb_object_keys(NEW.payload))<>4 OR NEW.payload IS DISTINCT FROM jsonb_build_object('warehouseId',NEW.payload->>'warehouseId','customerId',NEW.payload->>'customerId','productId',NEW.payload->>'productId','quantity',NEW.payload->>'quantity') OR (NEW.payload->>'warehouseId')::uuid IS NULL OR (NEW.payload->>'customerId')::uuid IS NULL OR (NEW.payload->>'productId')::uuid IS NULL OR (NEW.payload->>'quantity') !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$' OR (NEW.payload->>'quantity')::numeric<=0 OR NEW.payload ?| ARRAY['unitPrice','price','tax','taxRate','accountId','actorId','balance','paidAmount','creditLimit','override'] OR NOT EXISTS(SELECT 1 FROM user_branch_scopes WHERE company_id=NEW.company_id AND user_id=actor_uuid() AND branch_id=NEW.branch_id) OR NOT EXISTS(SELECT 1 FROM warehouses WHERE company_id=NEW.company_id AND branch_id=NEW.branch_id AND id=(NEW.payload->>'warehouseId')::uuid AND active AND location_type='SELLABLE') THEN RAISE EXCEPTION 'service invoice draft source authority or shape invalid' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status='DRAFT' AND NEW.status='PENDING_APPROVAL' THEN
   IF NOT account_configuration_allowed('customer-invoices:submit') OR OLD.created_by IS DISTINCT FROM actor_uuid() OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() OR (to_jsonb(NEW)-ARRAY['status','approval_snapshot','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approval_snapshot','updated_by','updated_at']) OR NEW.approval_snapshot IS DISTINCT FROM service_invoice_policy_snapshot(NEW.id) THEN RAISE EXCEPTION 'service invoice submission snapshot, creator or policy invalid' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'service invoice lifecycle transition is not released' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_invoice_source_guard BEFORE INSERT OR UPDATE ON source_documents FOR EACH ROW EXECUTE FUNCTION service_invoice_source_guard();

CREATE FUNCTION service_invoice_source_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;v customer_invoice_valuations%ROWTYPE;expected jsonb;act text;old_status text;new_status text;rev integer;
BEGIN
 IF NEW.document_type<>'SERVICE_CREDIT_INVOICE' THEN RETURN NULL; END IF;
 SELECT * INTO s FROM source_documents WHERE company_id=NEW.company_id AND id=NEW.id;
 IF TG_OP='INSERT' THEN
  expected:=jsonb_build_object('documentType',s.document_type,'documentNumber',s.document_number,'branchId',s.branch_id,'customerId',s.payload->>'customerId','productId',s.payload->>'productId','quantity',s.payload->>'quantity');act:='CREATE';old_status:=NULL;new_status:='DRAFT';rev:=s.revision;
 ELSE
  IF OLD.status=NEW.status THEN RETURN NULL; END IF;
  SELECT * INTO v FROM customer_invoice_valuations WHERE company_id=s.company_id AND source_id=s.id AND source_revision=s.revision;
  IF s.status<>'PENDING_APPROVAL' OR v.source_id IS NULL OR s.approval_snapshot IS DISTINCT FROM service_invoice_policy_snapshot(s.id) THEN RAISE EXCEPTION 'submitted service invoice requires exact valuation and policy snapshots' USING ERRCODE='23514'; END IF;
  expected:=jsonb_build_object('from','DRAFT','to','PENDING_APPROVAL','revision',s.revision,'valuationId',v.id,'currency',v.currency,'net',v.net::text,'tax',v.tax::text,'gross',v.gross::text,'dueDate',to_char(v.due_date,'YYYY-MM-DD'));act:='SUBMIT';old_status:='DRAFT';new_status:='PENDING_APPROVAL';rev:=s.revision;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM document_events e WHERE e.company_id=s.company_id AND e.source_id=s.id AND e.actor_id=actor_uuid() AND e.created_at=now() AND e.action=act AND e.old_status IS NOT DISTINCT FROM old_status AND e.new_status=new_status AND e.revision=rev AND e.reason=current_setting('app.reason',true)) OR NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=s.company_id AND a.source_id=s.id AND a.entity_type='SERVICE_CREDIT_INVOICE' AND a.entity_id=s.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action=act AND a.reason=current_setting('app.reason',true) AND a.new_values=expected) THEN RAISE EXCEPTION 'service invoice transition requires exact attributable audit and event' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER service_invoice_source_complete AFTER INSERT OR UPDATE ON source_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION service_invoice_source_complete();

COMMIT;
