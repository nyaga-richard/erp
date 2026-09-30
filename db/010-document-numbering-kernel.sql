BEGIN;
-- Reviewed migration defaults, not account IDs/tax rates and not editable by application SQL.
CREATE TABLE document_numbering_defaults(
 document_type text PRIMARY KEY,
 prefix text NOT NULL CHECK(prefix ~ '^[A-Z][A-Z0-9-]{1,15}$'),
 padding integer NOT NULL CHECK(padding BETWEEN 4 AND 12),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
INSERT INTO document_numbering_defaults(document_type,prefix,padding) VALUES('MANUAL_JOURNAL','JDR',6),('JOURNAL_REVERSAL','REV',6),('JOURNAL','JE',6);
GRANT SELECT ON document_numbering_defaults TO erp_runtime;
ALTER TABLE document_sequences ADD padding integer NOT NULL DEFAULT 6 CHECK(padding BETWEEN 4 AND 12), ADD allocated_by uuid NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001' REFERENCES users(id), ADD allocated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE document_sequences ALTER allocated_by SET DEFAULT actor_uuid();
REVOKE UPDATE ON document_sequences FROM erp_runtime;
GRANT UPDATE(last_value) ON document_sequences TO erp_runtime;
CREATE FUNCTION sequence_counter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg document_numbering_defaults%ROWTYPE;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NEW; END IF;
 IF actor_uuid() IS NULL OR NEW.company_id IS DISTINCT FROM company_uuid() THEN RAISE EXCEPTION 'sequence requires authenticated transaction context' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO cfg FROM document_numbering_defaults WHERE document_type=NEW.document_type;
  IF cfg.document_type IS NULL OR NEW.prefix<>cfg.prefix OR NEW.padding<>cfg.padding OR NEW.last_value<>1 THEN RAISE EXCEPTION 'sequence must use registered format and start at one' USING ERRCODE='23514'; END IF;
 ELSE
  IF (NEW.company_id,NEW.branch_id,NEW.document_type,NEW.financial_year,NEW.prefix,NEW.padding) IS DISTINCT FROM (OLD.company_id,OLD.branch_id,OLD.document_type,OLD.financial_year,OLD.prefix,OLD.padding) OR NEW.last_value<>OLD.last_value+1 THEN RAISE EXCEPTION 'sequence identity/format immutable; counter must increment exactly once' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.allocated_by=actor_uuid();NEW.allocated_at=now();RETURN NEW;
END $$;
CREATE TRIGGER sequence_counter BEFORE INSERT OR UPDATE ON document_sequences FOR EACH ROW EXECUTE FUNCTION sequence_counter_guard();
CREATE FUNCTION sequence_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE number_text text;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NULL; END IF;
 number_text=NEW.prefix||'-'||NEW.financial_year::text||'-'||lpad(NEW.last_value::text,greatest(NEW.padding,length(NEW.last_value::text)),'0');
 IF NEW.document_type='JOURNAL' THEN
  IF NOT EXISTS(SELECT 1 FROM journal_entries WHERE company_id=NEW.company_id AND branch_id=NEW.branch_id AND number=number_text AND extract(year FROM accounting_date)::integer=NEW.financial_year AND created_by=NEW.allocated_by AND posted_at=NEW.allocated_at) THEN RAISE EXCEPTION 'allocated journal number lacks same-transaction journal' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM source_documents WHERE company_id=NEW.company_id AND branch_id=NEW.branch_id AND document_type=NEW.document_type AND document_number=number_text AND extract(year FROM business_date)::integer=NEW.financial_year AND created_by=NEW.allocated_by AND created_at=NEW.allocated_at) THEN RAISE EXCEPTION 'allocated document number lacks same-transaction source' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sequence_commit AFTER INSERT OR UPDATE ON document_sequences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sequence_commit_guard();
CREATE FUNCTION document_number_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind text; number_text text; document_date date;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='journal_entries' THEN kind='JOURNAL';number_text=NEW.number;document_date=NEW.accounting_date;
 ELSE kind=NEW.document_type;number_text=NEW.document_number;document_date=NEW.business_date; END IF;
 IF NOT EXISTS(SELECT 1 FROM document_sequences s WHERE s.company_id=NEW.company_id AND s.branch_id=NEW.branch_id AND s.document_type=kind AND s.financial_year=extract(year FROM document_date)::integer AND s.allocated_by=actor_uuid() AND s.allocated_at=now() AND number_text=s.prefix||'-'||s.financial_year::text||'-'||lpad(s.last_value::text,greatest(s.padding,length(s.last_value::text)),'0')) THEN RAISE EXCEPTION 'document number must originate in this transaction allocator' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sequence_origin BEFORE INSERT ON source_documents FOR EACH ROW EXECUTE FUNCTION document_number_origin_guard();
CREATE TRIGGER sequence_origin BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION document_number_origin_guard();
COMMIT;
