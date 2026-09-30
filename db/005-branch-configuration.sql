BEGIN;
INSERT INTO permissions(code,description) VALUES('organization:view','View company branch configuration'),('organization:manage','Create and revise company branch configuration') ON CONFLICT DO NOTHING;
ALTER TABLE branches ADD version integer NOT NULL DEFAULT 1 CHECK(version>0), ADD created_at timestamptz, ADD updated_by uuid REFERENCES users(id), ADD updated_at timestamptz;
-- Do not invent creation timestamps for legacy branches.
ALTER TABLE branches ALTER created_at SET DEFAULT now();
CREATE FUNCTION branch_configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'branch deletion forbidden' USING ERRCODE='23514'; END IF;
 IF NEW.company_id IS DISTINCT FROM company_uuid() OR actor_uuid() IS NULL THEN RAISE EXCEPTION 'branch company/actor context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.version<>1 OR NEW.updated_by IS NOT NULL THEN RAISE EXCEPTION 'invalid branch creator/version' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.id,NEW.company_id,NEW.code,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.company_id,OLD.code,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'branch identity and origin are immutable' USING ERRCODE='23514'; END IF;
  IF NEW.version<>OLD.version+1 OR NEW.updated_by IS DISTINCT FROM actor_uuid() OR NEW.updated_at IS DISTINCT FROM now() THEN RAISE EXCEPTION 'branch revision/actor required' USING ERRCODE='23514'; END IF;
  IF OLD.active AND NOT NEW.active AND (EXISTS(SELECT 1 FROM source_documents WHERE company_id=OLD.company_id AND branch_id=OLD.id AND status NOT IN ('POSTED','CANCELLED')) OR EXISTS(SELECT 1 FROM warehouses WHERE company_id=OLD.company_id AND branch_id=OLD.id AND active)) THEN RAISE EXCEPTION 'branch has pending work or active warehouses' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER branch_configuration_integrity BEFORE INSERT OR UPDATE OR DELETE ON branches FOR EACH ROW EXECUTE FUNCTION branch_configuration_guard();
CREATE FUNCTION branch_configuration_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Owner/DBA bootstrap is a separate trusted maintenance boundary. API runtime must audit atomically.
 IF current_user='erp_runtime' AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='BRANCH' AND entity_id=NEW.id AND actor_id=actor_uuid() AND created_at=now() AND action IN ('BRANCH_CREATE','BRANCH_REVISE') AND new_values->'after'->>'version'=NEW.version::text) THEN RAISE EXCEPTION 'branch change requires atomic audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER branch_configuration_audit AFTER INSERT OR UPDATE ON branches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION branch_configuration_audited();
GRANT INSERT ON branches TO erp_runtime;
GRANT UPDATE(name,active,version,updated_by,updated_at) ON branches TO erp_runtime;
COMMIT;
