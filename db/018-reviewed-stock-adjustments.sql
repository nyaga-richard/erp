BEGIN;
INSERT INTO permissions(code,description) VALUES
 ('inventory:view','Read scoped stock adjustment sources and projections'),('inventory:cost:view','Inspect stock valuations and source snapshots'),('inventory:create','Propose stock gain or loss'),('inventory:submit','Submit or refresh own stock valuation'),('inventory:approve','Review stock adjustment sources'),('inventory:post','Post approved stock adjustments'),('inventory:cancel','Cancel unposted stock adjustments'),('inventory:reverse','Propose full linked stock reversal') ON CONFLICT DO NOTHING;
INSERT INTO document_numbering_defaults(document_type,prefix,padding) VALUES('STOCK_GAIN','SG',6),('STOCK_LOSS','SL',6),('STOCK_REVERSAL','SR',6);
CREATE UNIQUE INDEX one_stock_reversal ON source_documents(company_id,original_document_id) WHERE document_type='STOCK_REVERSAL' AND status<>'CANCELLED';
CREATE TABLE inventory_adjustment_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),source_id uuid NOT NULL UNIQUE,warehouse_id uuid NOT NULL,product_id uuid NOT NULL,
 original_movement_id uuid,FOREIGN KEY(company_id,original_movement_id) REFERENCES inventory_movements(company_id,id),
 quantity quantity_amount NOT NULL CHECK(quantity>0),gain_value money_amount CHECK(gain_value>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),FOREIGN KEY(company_id,warehouse_id) REFERENCES warehouses(company_id,id),FOREIGN KEY(company_id,product_id) REFERENCES products(company_id,id)
);
CREATE TABLE inventory_valuations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL REFERENCES companies(id),source_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),pool_version bigint NOT NULL CHECK(pool_version>=0),
 before_quantity quantity_amount NOT NULL CHECK(before_quantity>=0),before_value money_amount NOT NULL CHECK(before_value>=0),quantity_delta quantity_amount NOT NULL CHECK(quantity_delta<>0),value_delta money_amount NOT NULL CHECK(value_delta<>0),after_quantity quantity_amount NOT NULL CHECK(after_quantity>=0),after_value money_amount NOT NULL CHECK(after_value>=0),unit_cost unit_amount NOT NULL CHECK(unit_cost>=0),
 rule_id uuid NOT NULL,rule_snapshot jsonb NOT NULL DEFAULT '{}',created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,id),UNIQUE(company_id,source_id,revision),FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),FOREIGN KEY(company_id,rule_id) REFERENCES accounting_rule_sets(company_id,id),CHECK(after_quantity<>0 OR after_value=0),CHECK(before_quantity<>0 OR before_value=0)
);
ALTER TABLE inventory_movements ADD valuation_id uuid UNIQUE, ADD pool_version bigint;
ALTER TABLE inventory_movements ADD FOREIGN KEY(company_id,valuation_id) REFERENCES inventory_valuations(company_id,id);
ALTER TABLE inventory_balances ADD last_valued_date date;
CREATE INDEX inventory_adjustment_search ON inventory_adjustment_lines(company_id,warehouse_id,product_id);
CREATE INDEX inventory_movement_pool ON inventory_movements(company_id,warehouse_id,product_id,pool_version);
CREATE FUNCTION stock_rule_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('rule',to_jsonb(r),'effectiveTo',posting_rule_end(r.company_id,r.id),'legs',(SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('account',to_jsonb(a)) ORDER BY l.leg_code) FROM accounting_rule_legs l JOIN accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE l.company_id=r.company_id AND l.rule_set_id=r.id)) FROM accounting_rule_sets r WHERE r.id=p_id
$$;
CREATE FUNCTION stock_identity(p_source uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;l inventory_adjustment_lines%ROWTYPE;prec integer;
BEGIN
 SELECT * INTO s FROM source_documents WHERE id=p_source;SELECT * INTO l FROM inventory_adjustment_lines WHERE source_id=p_source;
 IF s.company_id IS DISTINCT FROM company_uuid() OR l.id IS NULL OR s.document_type NOT IN ('STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL') OR NOT EXISTS(SELECT 1 FROM user_branch_scopes WHERE company_id=s.company_id AND user_id=actor_uuid() AND branch_id=s.branch_id) THEN RAISE EXCEPTION 'stock source scope invalid' USING ERRCODE='23514'; END IF;
 SELECT u.quantity_scale INTO prec FROM products p JOIN units_of_measure u ON u.company_id=p.company_id AND u.id=p.uom_id WHERE p.company_id=s.company_id AND p.id=l.product_id AND p.publication_request_id IS NOT NULL AND p.active AND p.item_type='STOCK' AND NOT p.serialized AND NOT p.batch_controlled AND NOT p.expiry_controlled;
 IF (s.document_type='STOCK_REVERSAL') IS DISTINCT FROM (l.original_movement_id IS NOT NULL) OR (l.original_movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN source_documents o ON o.id=m.source_id WHERE m.id=l.original_movement_id AND m.company_id=s.company_id AND o.id=s.original_document_id AND o.status='POSTED' AND o.original_document_id IS NULL AND abs(m.quantity)=l.quantity AND m.warehouse_id=l.warehouse_id AND m.product_id=l.product_id)) THEN RAISE EXCEPTION 'original stock movement required for a full linked reversal' USING ERRCODE='23514'; END IF;
 IF prec IS NULL OR trunc(l.quantity,prec)<>l.quantity OR (s.document_type='STOCK_GAIN') IS DISTINCT FROM (l.gain_value IS NOT NULL) OR s.currency<>(SELECT base_currency FROM companies WHERE id=s.company_id) OR s.exchange_rate<>1 OR NOT EXISTS(SELECT 1 FROM warehouses w JOIN branches b ON b.company_id=w.company_id AND b.id=w.branch_id WHERE w.company_id=s.company_id AND w.id=l.warehouse_id AND w.branch_id=s.branch_id AND w.active AND b.active AND w.location_type='SELLABLE') THEN RAISE EXCEPTION 'stock identity or precision invalid' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION stock_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;
BEGIN
 SELECT * INTO s FROM source_documents WHERE id=NEW.source_id;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR s.company_id IS DISTINCT FROM NEW.company_id OR s.created_at IS DISTINCT FROM now() OR s.created_by IS DISTINCT FROM actor_uuid() OR s.status<>'DRAFT' OR NOT account_configuration_allowed(CASE WHEN s.document_type='STOCK_REVERSAL' THEN 'inventory:reverse' ELSE 'inventory:create' END) OR NOT account_configuration_allowed('inventory:cost:view') THEN RAISE EXCEPTION 'stock line requires own initial draft and authority' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER stock_line_guard BEFORE INSERT ON inventory_adjustment_lines FOR EACH ROW EXECUTE FUNCTION stock_line_guard();
CREATE TRIGGER stock_line_immutable BEFORE UPDATE OR DELETE ON inventory_adjustment_lines FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION stock_check_rule(p_source uuid,p_rule uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;l inventory_adjustment_lines%ROWTYPE;winner uuid;n integer;
BEGIN
 SELECT * INTO s FROM source_documents WHERE id=p_source;SELECT * INTO l FROM inventory_adjustment_lines WHERE source_id=p_source;
 IF s.document_type='STOCK_REVERSAL' THEN
  IF NOT EXISTS(SELECT 1 FROM inventory_movements m JOIN inventory_valuations ov ON ov.id=m.valuation_id WHERE m.id=l.original_movement_id AND ov.rule_id=p_rule) THEN RAISE EXCEPTION 'reversal must retain original rule' USING ERRCODE='23514'; END IF;
 ELSE
 WITH ranked AS(SELECT r.id,dense_rank() OVER(ORDER BY priority DESC,((branch_id IS NOT NULL)::int+(warehouse_id IS NOT NULL)::int) DESC) rank FROM accounting_rule_sets r WHERE r.company_id=s.company_id AND r.event_type=s.document_type AND r.active AND r.publication_request_id IS NOT NULL AND r.valid_from<=s.business_date AND (posting_rule_end(r.company_id,r.id) IS NULL OR posting_rule_end(r.company_id,r.id)>=s.business_date) AND (r.branch_id IS NULL OR r.branch_id=s.branch_id) AND (r.warehouse_id IS NULL OR r.warehouse_id=l.warehouse_id)) SELECT count(*),(array_agg(id))[1] INTO n,winner FROM ranked WHERE rank=1;
 IF n<>1 OR winner IS DISTINCT FROM p_rule THEN RAISE EXCEPTION 'stock rule missing ambiguous or stale' USING ERRCODE='23514'; END IF;
 END IF;
 IF (SELECT count(*) FROM accounting_rule_legs WHERE rule_set_id=p_rule)<>2 OR EXISTS(SELECT 1 FROM accounting_rule_legs rl JOIN accounting_rule_sets r ON r.id=rl.rule_set_id LEFT JOIN accounts a ON a.company_id=r.company_id AND a.id=rl.account_id WHERE r.id=p_rule AND (a.id IS NULL OR NOT a.active OR NOT a.postable OR coalesce(a.currency,s.currency)<>s.currency OR NOT EXISTS(SELECT 1 FROM posting_event_leg_contracts c JOIN posting_event_leg_eligibility e USING(event_type,contract_version,leg_code) WHERE c.event_type=r.event_type AND c.contract_version=r.contract_version AND c.leg_code=rl.leg_code AND c.side=rl.side AND c.amount_key=rl.amount_key AND e.account_type=a.account_type AND e.control_type IS NOT DISTINCT FROM a.control_type))) THEN RAISE EXCEPTION 'stock mapping accounts unavailable' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION stock_valuation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;l inventory_adjustment_lines%ROWTYPE;b inventory_balances%ROWTYPE;q numeric;v numeric;
BEGIN
 PERFORM stock_identity(NEW.source_id);SELECT * INTO s FROM source_documents WHERE id=NEW.source_id;SELECT * INTO l FROM inventory_adjustment_lines WHERE source_id=s.id;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.company_id::text||l.warehouse_id::text||l.product_id::text,91));
 SELECT * INTO b FROM inventory_balances WHERE company_id=s.company_id AND warehouse_id=l.warehouse_id AND product_id=l.product_id;
 IF NEW.company_id IS DISTINCT FROM s.company_id OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR s.created_by IS DISTINCT FROM actor_uuid() OR s.status<>'DRAFT' OR NEW.revision<>s.revision OR NOT account_configuration_allowed('inventory:submit') OR NOT account_configuration_allowed('inventory:cost:view') OR NEW.pool_version<>coalesce(b.version,0) OR NEW.before_quantity<>coalesce(b.quantity,0) OR NEW.before_value<>coalesce(b.base_value,0) OR s.business_date<coalesce(b.last_valued_date,s.business_date) THEN RAISE EXCEPTION 'stock valuation authority or current state invalid' USING ERRCODE='23514'; END IF;
 IF s.document_type='STOCK_REVERSAL' THEN SELECT -quantity,-base_value INTO q,v FROM inventory_movements WHERE id=l.original_movement_id;ELSIF s.document_type='STOCK_GAIN' THEN q=l.quantity;v=l.gain_value;ELSE q=-l.quantity;IF l.quantity>NEW.before_quantity THEN RAISE EXCEPTION 'insufficient stock' USING ERRCODE='23514'; END IF;v=-CASE WHEN l.quantity=NEW.before_quantity THEN NEW.before_value ELSE round(NEW.before_value*l.quantity/NEW.before_quantity,2) END; END IF;
 IF NEW.quantity_delta<>q OR NEW.value_delta<>v OR NEW.after_quantity<>NEW.before_quantity+q OR NEW.after_value<>NEW.before_value+v OR NEW.unit_cost<>round(abs(v)/l.quantity,6) THEN RAISE EXCEPTION 'stock valuation arithmetic mismatch' USING ERRCODE='23514'; END IF;
 PERFORM stock_check_rule(s.id,NEW.rule_id);IF s.document_type='STOCK_REVERSAL' THEN SELECT ov.rule_snapshot INTO NEW.rule_snapshot FROM inventory_movements m JOIN inventory_valuations ov ON ov.id=m.valuation_id WHERE m.id=l.original_movement_id;ELSE NEW.rule_snapshot=stock_rule_snapshot(NEW.rule_id);END IF;RETURN NEW;
END $$;
CREATE TRIGGER stock_valuation_guard BEFORE INSERT ON inventory_valuations FOR EACH ROW EXECUTE FUNCTION stock_valuation_guard();
CREATE TRIGGER stock_valuation_immutable BEFORE UPDATE OR DELETE ON inventory_valuations FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION stock_policy_snapshot(p_source uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE s source_documents%ROWTYPE;v inventory_valuations%ROWTYPE;p approval_policies%ROWTYPE;co companies%ROWTYPE;steps jsonb;
BEGIN
 SELECT * INTO s FROM source_documents WHERE id=p_source;SELECT * INTO v FROM inventory_valuations WHERE source_id=s.id AND revision=s.revision;SELECT * INTO co FROM companies WHERE id=s.company_id;
 SELECT * INTO p FROM approval_policies WHERE company_id=s.company_id AND event_type=s.document_type AND branch_id IS NULL AND active AND threshold_base<=abs(v.value_delta) ORDER BY threshold_base DESC LIMIT 1;
 IF p.id IS NULL THEN RETURN jsonb_build_object('origin','COMPANY_BASELINE','policyId',NULL,'version',1,'revision',s.revision,'baseAmount',abs(v.value_delta)::text,'independentCreator',co.independent_approval,'independentPoster',co.independent_posting,'steps',jsonb_build_array(jsonb_build_object('number',1,'permission','inventory:approve','minimumApprovers',1,'stepId',NULL))); END IF;
 SELECT jsonb_agg(jsonb_build_object('stepId',id,'number',step_no,'permission',required_permission,'minimumApprovers',minimum_approvers) ORDER BY step_no) INTO steps FROM approval_steps WHERE company_id=s.company_id AND policy_id=p.id;
 RETURN jsonb_build_object('origin','PUBLISHED_POLICY','policyId',p.id,'version',p.version,'revision',s.revision,'baseAmount',abs(v.value_delta)::text,'threshold',p.threshold_base::text,'independentCreator',p.independent_creator,'independentPoster',p.independent_poster,'steps',steps);
END $$;
CREATE FUNCTION stock_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE perm text;
BEGIN
 IF NEW.document_type NOT IN ('STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.company_id::text,77));
 IF TG_OP='INSERT' THEN perm=CASE WHEN NEW.document_type='STOCK_REVERSAL' THEN 'inventory:reverse' ELSE 'inventory:create' END;IF NEW.payload<>'{}'::jsonb OR (NEW.document_type='STOCK_REVERSAL') IS DISTINCT FROM (NEW.original_document_id IS NOT NULL) OR NEW.created_at<>now() OR NEW.initiated_by IS DISTINCT FROM NEW.created_by THEN RAISE EXCEPTION 'invalid stock source origin' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM stock_identity(NEW.id);IF NEW.updated_at IS DISTINCT FROM now() OR (NEW.status='APPROVED' AND OLD.status<>'APPROVED' AND NEW.approved_at IS DISTINCT FROM now()) OR (NEW.status='POSTED' AND NEW.posted_at IS DISTINCT FROM now()) OR (NEW.status='CANCELLED' AND NEW.cancelled_at IS DISTINCT FROM now()) THEN RAISE EXCEPTION 'stock transition timestamps must be current' USING ERRCODE='23514'; END IF;
  IF NEW.revision=OLD.revision+1 THEN perm='inventory:submit';IF NEW.payload IS DISTINCT FROM OLD.payload OR NEW.business_date<>OLD.business_date OR NEW.description<>OLD.description OR NEW.currency<>OLD.currency OR NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'stock refresh cannot change immutable request' USING ERRCODE='23514'; END IF;
  ELSE perm=CASE WHEN OLD.status='DRAFT' AND NEW.status='PENDING_APPROVAL' THEN 'inventory:submit' WHEN OLD.status='PENDING_APPROVAL' AND NEW.status IN ('PENDING_APPROVAL','APPROVED','REJECTED') THEN 'inventory:approve' WHEN NEW.status='POSTED' THEN 'inventory:post' WHEN NEW.status='CANCELLED' THEN 'inventory:cancel' END;
  END IF;
  IF OLD.status='DRAFT' AND NEW.status='PENDING_APPROVAL' AND (NEW.approval_snapshot IS DISTINCT FROM stock_policy_snapshot(NEW.id) OR NEW.created_by<>actor_uuid()) THEN RAISE EXCEPTION 'stock policy snapshot must reflect reviewed configuration and value' USING ERRCODE='23514'; END IF;
 END IF;
 IF perm IS NULL OR NOT account_configuration_allowed(perm) OR NOT account_configuration_allowed('inventory:cost:view') OR NOT EXISTS(SELECT 1 FROM user_branch_scopes WHERE company_id=NEW.company_id AND user_id=actor_uuid() AND branch_id=NEW.branch_id) THEN RAISE EXCEPTION 'stock permission or branch required' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER stock_source_guard BEFORE INSERT OR UPDATE ON source_documents FOR EACH ROW EXECUTE FUNCTION stock_source_guard();
CREATE FUNCTION stock_movement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;l inventory_adjustment_lines%ROWTYPE;v inventory_valuations%ROWTYPE;b inventory_balances%ROWTYPE;j journal_entries%ROWTYPE;
BEGIN
 PERFORM stock_identity(NEW.source_id);SELECT * INTO s FROM source_documents WHERE id=NEW.source_id;SELECT * INTO l FROM inventory_adjustment_lines WHERE source_id=s.id;SELECT * INTO v FROM inventory_valuations WHERE id=NEW.valuation_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(s.company_id::text||l.warehouse_id::text||l.product_id::text,91));SELECT * INTO b FROM inventory_balances WHERE company_id=s.company_id AND warehouse_id=l.warehouse_id AND product_id=l.product_id;SELECT * INTO j FROM journal_entries WHERE id=NEW.journal_id;
 IF NOT account_configuration_allowed('inventory:post') OR NOT account_configuration_allowed('inventory:cost:view') OR s.status<>'APPROVED' OR v.id IS NULL OR v.source_id<>s.id OR v.revision<>s.revision OR v.pool_version<>coalesce(b.version,0) OR v.before_quantity<>coalesce(b.quantity,0) OR v.before_value<>coalesce(b.base_value,0) OR s.business_date<coalesce(b.last_valued_date,s.business_date) OR NEW.company_id IS DISTINCT FROM s.company_id OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NEW.approved_by IS DISTINCT FROM s.approved_by OR NEW.source_line_id<>l.id OR NEW.warehouse_id<>l.warehouse_id OR NEW.product_id<>l.product_id OR NEW.quantity<>v.quantity_delta OR NEW.base_value<>v.value_delta OR NEW.unit_cost<>v.unit_cost OR NEW.pool_version IS DISTINCT FROM v.pool_version+1 OR NEW.movement_type<>'STOCK_ADJUSTMENT' OR NEW.lot_id IS NOT NULL OR NEW.serial_id IS NOT NULL OR NEW.original_movement_id IS DISTINCT FROM l.original_movement_id OR NEW.occurred_at IS DISTINCT FROM (s.business_date::timestamp AT TIME ZONE 'Africa/Nairobi') OR j.source_id IS DISTINCT FROM s.id OR j.status<>'POSTED' OR j.posted_by IS DISTINCT FROM actor_uuid() THEN RAISE EXCEPTION 'stock movement must match current approved source valuation and journal' USING ERRCODE='23514'; END IF;
 PERFORM stock_check_rule(s.id,v.rule_id);IF s.document_type<>'STOCK_REVERSAL' AND v.rule_snapshot IS DISTINCT FROM stock_rule_snapshot(v.rule_id) THEN RAISE EXCEPTION 'reviewed stock mapping changed' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER stock_movement_guard BEFORE INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_guard();
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE FUNCTION stock_apply_projection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.inventory_balances(company_id,created_by,warehouse_id,product_id,quantity,base_value,version,last_valued_date) SELECT NEW.company_id,NEW.created_by,NEW.warehouse_id,NEW.product_id,v.after_quantity,v.after_value,NEW.pool_version,s.business_date FROM public.inventory_valuations v JOIN public.source_documents s ON s.id=v.source_id WHERE v.id=NEW.valuation_id
 ON CONFLICT(company_id,warehouse_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity,base_value=EXCLUDED.base_value,version=EXCLUDED.version,last_valued_date=EXCLUDED.last_valued_date;RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION stock_apply_projection() FROM PUBLIC;
CREATE TRIGGER stock_apply_projection AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION stock_apply_projection();
CREATE FUNCTION stock_source_snapshot(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('source',to_jsonb(s),'line',(SELECT to_jsonb(l)||jsonb_build_object('quantity',l.quantity::text,'gain_value',l.gain_value::text) FROM inventory_adjustment_lines l WHERE source_id=s.id),'valuation',(SELECT to_jsonb(v)||jsonb_build_object('pool_version',v.pool_version::text,'before_quantity',v.before_quantity::text,'before_value',v.before_value::text,'after_quantity',v.after_quantity::text,'after_value',v.after_value::text,'quantity_delta',v.quantity_delta::text,'value_delta',v.value_delta::text,'unit_cost',v.unit_cost::text) FROM inventory_valuations v WHERE source_id=s.id AND revision=s.revision)) FROM source_documents s WHERE s.id=p_id
$$;
CREATE FUNCTION stock_control_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM accounts a WHERE a.id=NEW.account_id AND a.control_type='INVENTORY') AND NOT EXISTS(SELECT 1 FROM journal_entries j JOIN source_documents s ON s.id=j.source_id JOIN inventory_valuations v ON v.source_id=s.id AND v.revision=s.revision WHERE j.id=NEW.journal_id AND s.document_type IN ('STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL')) THEN RAISE EXCEPTION 'inventory control requires a released valued stock source' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER stock_control_line_guard BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION stock_control_line_guard();
CREATE FUNCTION stock_source_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_documents%ROWTYPE;v inventory_valuations%ROWTYPE;j journal_entries%ROWTYPE;n integer;
BEGIN
 IF NEW.document_type NOT IN ('STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL') THEN RETURN NULL; END IF;
 SELECT * INTO s FROM source_documents WHERE id=NEW.id;PERFORM stock_identity(s.id);SELECT * INTO v FROM inventory_valuations WHERE source_id=s.id AND revision=s.revision;
 IF s.status IN ('PENDING_APPROVAL','APPROVED','POSTED') AND v.id IS NULL THEN RAISE EXCEPTION 'valued stock source required' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=s.company_id AND source_id=s.id AND entity_type='INVENTORY_SOURCE' AND actor_id=actor_uuid() AND created_at=now() AND new_values=stock_source_snapshot(s.id) AND EXISTS(SELECT 1 FROM document_events e WHERE e.source_id=s.id AND e.actor_id=actor_uuid() AND e.created_at=now() AND e.revision=s.revision AND e.new_status=s.status AND e.action=audit_logs.action AND e.action IN ('CREATE','SUBMIT','APPROVE','REJECT','POST','REFRESH','CANCEL'))) THEN RAISE EXCEPTION 'complete exact stock source audit required' USING ERRCODE='23514'; END IF;
 IF s.status='POSTED' THEN
  SELECT * INTO j FROM journal_entries WHERE source_id=s.id;
  IF NOT EXISTS(SELECT 1 FROM inventory_movements WHERE company_id=s.company_id AND source_id=s.id AND valuation_id=v.id AND journal_id=j.id) OR NOT EXISTS(SELECT 1 FROM journal_posting_rule_applications WHERE company_id=s.company_id AND journal_id=j.id AND rule_set_id=v.rule_id) OR j.reversal_of IS DISTINCT FROM (SELECT id FROM journal_entries WHERE source_id=s.original_document_id) OR j.rule_snapshot IS DISTINCT FROM jsonb_build_object('valuationId',v.id,'valuation',stock_source_snapshot(s.id)->'valuation') THEN RAISE EXCEPTION 'stock posting effects or snapshot incomplete' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO n FROM journal_lines WHERE journal_id=j.id;IF n<>2 OR EXISTS(SELECT 1 FROM accounting_rule_legs rl WHERE rl.rule_set_id=v.rule_id AND NOT EXISTS(SELECT 1 FROM journal_lines jl WHERE jl.journal_id=j.id AND jl.account_id=rl.account_id AND jl.description=replace(rl.leg_code,'_',' ') AND jl.debit=CASE WHEN (rl.side='DEBIT')<>(s.document_type='STOCK_REVERSAL') THEN abs(v.value_delta) ELSE 0 END AND jl.credit=CASE WHEN (rl.side='CREDIT')<>(s.document_type='STOCK_REVERSAL') THEN abs(v.value_delta) ELSE 0 END)) THEN RAISE EXCEPTION 'stock journal differs from reviewed mapping and exact valuation' USING ERRCODE='23514'; END IF;
 END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_source_complete AFTER INSERT OR UPDATE ON source_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stock_source_complete();
CREATE FUNCTION stock_valuation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM source_documents s JOIN audit_logs a ON a.source_id=s.id WHERE s.id=NEW.source_id AND s.revision=NEW.revision AND s.status IN ('PENDING_APPROVAL','APPROVED','POSTED') AND s.updated_at=now() AND a.entity_type='INVENTORY_SOURCE' AND a.actor_id=NEW.created_by AND a.created_at=now() AND a.new_values=stock_source_snapshot(s.id)) THEN RAISE EXCEPTION 'stock valuation requires atomic submitted source and exact audit' USING ERRCODE='23514'; END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER stock_valuation_complete AFTER INSERT ON inventory_valuations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stock_valuation_complete();
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['inventory_adjustment_lines','inventory_valuations'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY company_isolation ON %I USING(company_id=company_uuid()) WITH CHECK(company_id=company_uuid())',t);END LOOP;END $$;
GRANT SELECT,INSERT ON inventory_adjustment_lines,inventory_valuations TO erp_runtime;
GRANT SELECT,INSERT ON inventory_movements TO erp_runtime;
GRANT SELECT ON inventory_balances TO erp_runtime;
CREATE FUNCTION stock_rule_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT account_configuration_allowed('inventory:post') OR NOT account_configuration_allowed('inventory:cost:view') OR NOT EXISTS(SELECT 1 FROM journal_entries j JOIN source_documents s ON s.id=j.source_id JOIN inventory_valuations v ON v.source_id=s.id AND v.revision=s.revision WHERE j.company_id=NEW.company_id AND j.id=NEW.journal_id AND j.status='POSTED' AND j.posted_at=now() AND j.posted_by=actor_uuid() AND s.status='APPROVED' AND v.rule_id=NEW.rule_set_id AND s.document_type IN ('STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL')) THEN RAISE EXCEPTION 'rule application requires this authorized stock posting transaction' USING ERRCODE='23514'; END IF;RETURN NEW;
END $$;
CREATE TRIGGER stock_rule_application_guard BEFORE INSERT ON journal_posting_rule_applications FOR EACH ROW EXECUTE FUNCTION stock_rule_application_guard();
GRANT INSERT ON journal_posting_rule_applications TO erp_runtime;
CREATE OR REPLACE FUNCTION warehouse_has_dependencies(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id JOIN public.companies c ON c.id=m.company_id JOIN public.user_roles ur ON ur.company_id=m.company_id AND ur.user_id=m.user_id JOIN public.role_permissions rp ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id WHERE m.company_id=public.company_uuid() AND m.user_id=public.actor_uuid() AND m.active AND u.active AND c.active AND rp.permission_code IN ('warehouses:view','warehouses:manage')) THEN RAISE EXCEPTION 'warehouse dependency permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE company_id=public.company_uuid() AND id=p_id) THEN RAISE EXCEPTION 'warehouse dependency scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(
SELECT 1 FROM public.inventory_adjustment_lines WHERE company_id=public.company_uuid() AND warehouse_id=p_id
 UNION ALL
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
