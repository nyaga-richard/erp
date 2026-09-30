BEGIN;
INSERT INTO permissions(code,description) VALUES
 ('organization:profile:manage','Revise company display name; no legal or accounting identity changes'),
 ('warehouses:view','View company warehouse configuration'),
 ('warehouses:manage','Create and revise warehouse configuration') ON CONFLICT DO NOTHING;
ALTER TABLE companies ADD version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD updated_by uuid REFERENCES users(id), ADD updated_at timestamptz;
ALTER TABLE warehouses ADD version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD created_at timestamptz, ADD updated_by uuid REFERENCES users(id), ADD updated_at timestamptz;
ALTER TABLE warehouses ALTER created_at SET DEFAULT now();
-- Fixed SQL, explicitly tenant-bound. No domain SELECT/DML grant is given to the runtime.
CREATE FUNCTION warehouse_has_dependencies(p_id uuid) RETURNS boolean
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
 );
END $$;
REVOKE ALL ON FUNCTION warehouse_has_dependencies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warehouse_has_dependencies(uuid) TO erp_runtime;
CREATE FUNCTION company_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'company deletion forbidden' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'company actor/scope required' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['name','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','version','updated_by','updated_at']) THEN RAISE EXCEPTION 'company identity and accounting configuration immutable' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() OR length(trim(NEW.name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'invalid company revision/actor/name' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_profile_integrity BEFORE UPDATE OR DELETE ON companies FOR EACH ROW EXECUTE FUNCTION company_profile_guard();
CREATE FUNCTION warehouse_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'warehouse deletion forbidden' USING ERRCODE='23514'; END IF;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'warehouse actor/scope required' USING ERRCODE='23514'; END IF;
 IF length(trim(NEW.name)) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'invalid warehouse name' USING ERRCODE='23514'; END IF;
 IF NEW.active THEN
  PERFORM 1 FROM branches WHERE company_id=NEW.company_id AND id=NEW.branch_id AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'warehouse requires active same-company branch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.version<>1 OR NEW.updated_by IS NOT NULL OR NEW.code !~ '^[A-Z0-9][A-Z0-9_-]{1,23}$' THEN RAISE EXCEPTION 'invalid warehouse origin/code/version' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['name','active','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','active','version','updated_by','updated_at']) THEN RAISE EXCEPTION 'warehouse identity, parent, type and creator immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'invalid warehouse revision/actor' USING ERRCODE='23514'; END IF;
  IF OLD.active AND NOT NEW.active AND warehouse_has_dependencies(OLD.id) THEN RAISE EXCEPTION 'warehouse has operational dependencies' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER warehouse_configuration_integrity BEFORE INSERT OR UPDATE OR DELETE ON warehouses FOR EACH ROW EXECUTE FUNCTION warehouse_configuration_guard();
CREATE FUNCTION organization_configuration_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE co uuid; entity text;
BEGIN
 co:=CASE WHEN TG_TABLE_NAME='companies' THEN NEW.id ELSE (to_jsonb(NEW)->>'company_id')::uuid END;
 entity:=CASE WHEN TG_TABLE_NAME='companies' THEN 'COMPANY' ELSE 'WAREHOUSE' END;
 IF current_user='erp_runtime' AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=co AND entity_type=entity AND entity_id=NEW.id AND actor_id=actor_uuid() AND created_at=now() AND action IN ('COMPANY_REVISE','WAREHOUSE_CREATE','WAREHOUSE_REVISE') AND new_values->'after'->>'version'=NEW.version::text) THEN RAISE EXCEPTION 'organization configuration requires atomic audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER company_profile_audit AFTER UPDATE ON companies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_configuration_audited();
CREATE CONSTRAINT TRIGGER warehouse_configuration_audit AFTER INSERT OR UPDATE ON warehouses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION organization_configuration_audited();
GRANT UPDATE(name,version,updated_by,updated_at) ON companies TO erp_runtime;
GRANT INSERT ON warehouses TO erp_runtime;
GRANT UPDATE(name,active,version,updated_by,updated_at) ON warehouses TO erp_runtime;
COMMIT;
