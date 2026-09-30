-- Create-only product reference metadata. Does not authorize stock or product posting.
BEGIN;
INSERT INTO permissions(code,description) VALUES('products:view','Search governed product reference masters'),('products:manage','Create immutable product reference metadata with audit') ON CONFLICT DO NOTHING;
ALTER TABLE units_of_measure ADD COLUMN catalog_version integer NOT NULL DEFAULT 0 CHECK(catalog_version IN (0,1));
ALTER TABLE product_categories ADD COLUMN catalog_version integer NOT NULL DEFAULT 0 CHECK(catalog_version IN (0,1));
ALTER TABLE brands ADD COLUMN catalog_version integer NOT NULL DEFAULT 0 CHECK(catalog_version IN (0,1));
CREATE FUNCTION product_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE walk uuid; visited uuid[]='{}'; parent_row product_categories%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF current_user<>'erp_runtime' AND OLD.catalog_version=0 THEN
   IF TG_OP='DELETE' THEN RETURN OLD; ELSIF NEW.catalog_version=0 THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'governed product references are immutable' USING ERRCODE='23514';
 END IF;
 IF current_user<>'erp_runtime' AND NEW.catalog_version=0 THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.company_id::text,77));
 IF NEW.catalog_version<>1 OR NEW.company_id IS DISTINCT FROM company_uuid() OR NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.created_at IS DISTINCT FROM now() OR NOT account_configuration_allowed('products:manage') THEN RAISE EXCEPTION 'product reference authority required' USING ERRCODE='23514'; END IF;
 IF length(trim(NEW.name)) NOT BETWEEN 2 AND 120 OR NEW.name<>trim(NEW.name) OR length(trim(current_setting('app.reason',true))) NOT BETWEEN 5 AND 500 OR current_setting('app.reason',true) IS NULL THEN RAISE EXCEPTION 'product reference name/reason required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME<>'brands' THEN
  IF NEW.code !~ '^[A-Z][A-Z0-9_-]{0,31}$' THEN RAISE EXCEPTION 'uppercase reference code required' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='product_categories' THEN
  walk=NEW.parent_id;
  WHILE walk IS NOT NULL LOOP
   IF walk=NEW.id OR walk=ANY(visited) OR cardinality(visited)>=19 THEN RAISE EXCEPTION 'category cycle or depth limit' USING ERRCODE='23514'; END IF;
   SELECT * INTO parent_row FROM product_categories WHERE company_id=NEW.company_id AND id=walk AND catalog_version=1;
   IF NOT FOUND THEN RAISE EXCEPTION 'governed same-company parent required' USING ERRCODE='23514'; END IF;
   visited=array_append(visited,walk);walk=parent_row.parent_id;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION product_reference_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind_name text;
BEGIN
 IF NEW.catalog_version=0 THEN RETURN NULL; END IF;
 kind_name=CASE TG_TABLE_NAME WHEN 'units_of_measure' THEN 'UNIT' WHEN 'product_categories' THEN 'CATEGORY' ELSE 'BRAND' END;
 IF NOT EXISTS(SELECT 1 FROM audit_logs a WHERE a.company_id=NEW.company_id AND a.entity_type='PRODUCT_REFERENCE' AND a.entity_id=NEW.id AND a.actor_id=actor_uuid() AND a.created_at=now() AND a.action='PRODUCT_REFERENCE_CREATE' AND a.reason=current_setting('app.reason',true) AND a.new_values=jsonb_build_object('before',NULL,'after',to_jsonb(NEW),'kind',kind_name)) THEN RAISE EXCEPTION 'product reference exact atomic audit required' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['units_of_measure','product_categories','brands'] LOOP
 EXECUTE format('CREATE TRIGGER product_reference_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION product_reference_guard()',t);
 EXECUTE format('CREATE CONSTRAINT TRIGGER product_reference_audited AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_reference_audited()',t);
 EXECUTE format('REVOKE UPDATE,DELETE,TRUNCATE ON %I FROM erp_runtime',t);
 EXECUTE format('GRANT SELECT,INSERT ON %I TO erp_runtime',t);
END LOOP; END $$;
COMMIT;
