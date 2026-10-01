BEGIN;
-- Company-scoped, operator-granted super-admin entitlement. The API role may
-- read but cannot set this flag; a reviewed erp_owner command grants it.
ALTER TABLE memberships ADD COLUMN super_admin boolean NOT NULL DEFAULT false;
CREATE INDEX memberships_super_admin_idx ON memberships(company_id,user_id) WHERE super_admin;

-- Common database-side authorization predicate. Super-admin grants resolve
-- against the permission catalog on each check, including codes added later.
CREATE FUNCTION actor_has_company_permission(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.memberships m
  JOIN public.users u ON u.id=m.user_id
  JOIN public.companies co ON co.id=m.company_id
  WHERE m.company_id=public.company_uuid() AND m.user_id=public.actor_uuid()
   AND m.active AND co.active AND u.active AND u.principal_type='HUMAN'
   AND EXISTS(SELECT 1 FROM public.permissions p WHERE p.code=p_permission)
   AND (m.super_admin OR EXISTS(
    SELECT 1 FROM public.user_roles ur JOIN public.role_permissions rp
     ON rp.company_id=ur.company_id AND rp.role_id=ur.role_id
    WHERE ur.company_id=m.company_id AND ur.user_id=m.user_id AND rp.permission_code=p_permission
   ))
 )
$$;
REVOKE ALL ON FUNCTION actor_has_company_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_has_company_permission(text) TO erp_runtime;

CREATE OR REPLACE FUNCTION account_configuration_allowed(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT public.actor_has_company_permission(p_permission)
$$;

-- Existing database invariants that check role_permissions directly must also
-- recognize the company-scoped entitlement, without weakening independent
-- creator/reviewer/poster constraints.
CREATE OR REPLACE FUNCTION decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NOT actor_has_company_permission(chosen->>'permission') THEN RAISE EXCEPTION 'step permission required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Preserve the final reviewed warehouse-dependency guard while allowing a
-- valid super-admin to inspect/close warehouses.
CREATE OR REPLACE FUNCTION warehouse_has_dependencies(p_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT public.actor_has_company_permission('warehouses:view') AND NOT public.actor_has_company_permission('warehouses:manage') THEN RAISE EXCEPTION 'warehouse dependency permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.warehouses WHERE company_id=public.company_uuid() AND id=p_id) THEN RAISE EXCEPTION 'warehouse dependency scope unavailable' USING ERRCODE='42501'; END IF;
 RETURN EXISTS(
  SELECT 1 FROM public.inventory_adjustment_lines WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.pos_terminals WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.inventory_movements WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.inventory_balances WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.stock_reservations WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.valuation_policies WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.stock_counts WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.stock_transfers WHERE company_id=public.company_uuid() AND (from_warehouse_id=p_id OR to_warehouse_id=p_id OR transit_warehouse_id=p_id)
  UNION ALL SELECT 1 FROM public.sales WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.sales_return_lines WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.purchase_requests WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.purchase_orders WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.grns WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.purchase_return_lines WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.accounting_rule_sets WHERE company_id=public.company_uuid() AND warehouse_id=p_id
  UNION ALL SELECT 1 FROM public.posting_rule_change_requests WHERE company_id=public.company_uuid() AND warehouse_id=p_id
 );
END $$;
REVOKE ALL ON FUNCTION warehouse_has_dependencies(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION warehouse_has_dependencies(uuid) TO erp_runtime;

-- Maintain explicit branch rows required by existing database triggers. This
-- also makes subsequently-created company branches available to super-admins.
CREATE FUNCTION sync_super_admin_branch_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO public.user_branch_scopes(company_id,user_id,branch_id)
 SELECT NEW.company_id,m.user_id,NEW.id FROM public.memberships m
 WHERE m.company_id=NEW.company_id AND m.active AND m.super_admin
 ON CONFLICT(company_id,user_id,branch_id) DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION sync_super_admin_branch_scope() FROM PUBLIC;
CREATE TRIGGER super_admin_branch_scope_sync AFTER INSERT ON branches
 FOR EACH ROW EXECUTE FUNCTION sync_super_admin_branch_scope();

COMMIT;
