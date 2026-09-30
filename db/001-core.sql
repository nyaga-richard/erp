BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE DOMAIN money_amount AS numeric(20,2);
CREATE DOMAIN quantity_amount AS numeric(20,6);
CREATE DOMAIN unit_amount AS numeric(20,6);
CREATE DOMAIN rate_amount AS numeric(20,10);

CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE, display_name text NOT NULL,
 principal_type text NOT NULL DEFAULT 'HUMAN' CHECK(principal_type IN ('HUMAN','SYSTEM','INTEGRATION')),
 service_code text UNIQUE, password_hash text, active boolean NOT NULL DEFAULT true,
 failed_logins integer NOT NULL DEFAULT 0 CHECK(failed_logins>=0), locked_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((principal_type='HUMAN' AND email IS NOT NULL AND password_hash IS NOT NULL) OR
       (principal_type<>'HUMAN' AND service_code IS NOT NULL AND password_hash IS NULL)),
 CHECK(email IS NULL OR email=lower(email))
);
CREATE TABLE currencies(code char(3) PRIMARY KEY, name text NOT NULL, scale smallint NOT NULL CHECK(scale BETWEEN 0 AND 4));
INSERT INTO currencies VALUES('KES','Kenyan shilling',2),('USD','US dollar',2),('EUR','Euro',2);
CREATE TABLE companies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, name text NOT NULL, tax_pin text,
 base_currency char(3) NOT NULL REFERENCES currencies(code), timezone text NOT NULL DEFAULT 'Africa/Nairobi',
 active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 independent_approval boolean NOT NULL DEFAULT true, independent_posting boolean NOT NULL DEFAULT true
);
CREATE TABLE memberships(company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), active boolean NOT NULL DEFAULT true, PRIMARY KEY(company_id,user_id));
CREATE TABLE branches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id), UNIQUE(company_id,id), UNIQUE(company_id,code));
CREATE TABLE warehouses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL, code text NOT NULL, name text NOT NULL, location_type text NOT NULL CHECK(location_type IN ('SELLABLE','TRANSIT','QUARANTINE','DAMAGED','RETURNS')), active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id), UNIQUE(company_id,id), UNIQUE(company_id,code), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id));
CREATE TABLE permissions(code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), UNIQUE(company_id,id), UNIQUE(company_id,name));
CREATE TABLE role_permissions(company_id uuid NOT NULL REFERENCES companies(id), role_id uuid NOT NULL, permission_code text NOT NULL REFERENCES permissions(code), PRIMARY KEY(company_id,role_id,permission_code), FOREIGN KEY(company_id,role_id) REFERENCES roles(company_id,id));
CREATE TABLE user_roles(company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), role_id uuid NOT NULL, PRIMARY KEY(company_id,user_id,role_id), FOREIGN KEY(company_id,role_id) REFERENCES roles(company_id,id), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id));
CREATE TABLE user_branch_scopes(company_id uuid NOT NULL REFERENCES companies(id), user_id uuid NOT NULL REFERENCES users(id), branch_id uuid NOT NULL, PRIMARY KEY(company_id,user_id,branch_id), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id));
CREATE TABLE sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE, csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), ip inet, device text);
CREATE TABLE password_reset_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE login_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), email_digest text NOT NULL, success boolean NOT NULL, reason text NOT NULL, ip inet, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX login_history_attempts ON login_history(email_digest,created_at);
CREATE TABLE financial_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), name text NOT NULL, starts_on date NOT NULL, ends_on date NOT NULL, status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED','LOCKED')), created_by uuid NOT NULL REFERENCES users(id), updated_by uuid REFERENCES users(id), updated_at timestamptz, UNIQUE(company_id,id), CHECK(ends_on>=starts_on), EXCLUDE USING gist(company_id WITH =, daterange(starts_on,ends_on,'[]') WITH &&));
CREATE TABLE accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), code text NOT NULL, name text NOT NULL, account_type text NOT NULL CHECK(account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')), parent_id uuid, control_type text, currency char(3) REFERENCES currencies(code), postable boolean NOT NULL DEFAULT true, active boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id), UNIQUE(company_id,id), UNIQUE(company_id,code), FOREIGN KEY(company_id,parent_id) REFERENCES accounts(company_id,id), CHECK(parent_id IS DISTINCT FROM id));
CREATE TABLE document_sequences(company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL, document_type text NOT NULL, financial_year integer NOT NULL, prefix text NOT NULL, last_value bigint NOT NULL DEFAULT 0 CHECK(last_value>=0), PRIMARY KEY(company_id,branch_id,document_type,financial_year), FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id));
CREATE TABLE source_documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL,
 document_type text NOT NULL, document_number text NOT NULL, business_date date NOT NULL, currency char(3) NOT NULL REFERENCES currencies(code), exchange_rate rate_amount NOT NULL DEFAULT 1 CHECK(exchange_rate>0),
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','POSTED','CANCELLED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), description text NOT NULL, payload jsonb NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), initiated_by uuid REFERENCES users(id),
 updated_by uuid REFERENCES users(id), updated_at timestamptz, approved_by uuid REFERENCES users(id), approved_at timestamptz,
 posted_by uuid REFERENCES users(id), posted_at timestamptz, cancelled_by uuid REFERENCES users(id), cancelled_at timestamptz,
 original_document_id uuid, reversal_reason text,
 UNIQUE(company_id,id), UNIQUE(company_id,branch_id,document_type,document_number),
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id),
 FOREIGN KEY(company_id,original_document_id) REFERENCES source_documents(company_id,id),
 CHECK((approved_by IS NULL)=(approved_at IS NULL)), CHECK((posted_by IS NULL)=(posted_at IS NULL)),
 CHECK(status<>'POSTED' OR posted_by IS NOT NULL), CHECK(status NOT IN ('APPROVED','POSTED') OR approved_by IS NOT NULL),
 CHECK(original_document_id IS NULL OR (reversal_reason IS NOT NULL AND length(trim(reversal_reason))>=5))
);
CREATE UNIQUE INDEX one_full_reversal ON source_documents(company_id,original_document_id) WHERE document_type='JOURNAL_REVERSAL' AND status<>'CANCELLED';
CREATE INDEX sources_lookup ON source_documents(company_id,business_date,id);
CREATE INDEX sources_creator ON source_documents(company_id,created_by,created_at);
CREATE INDEX sources_search ON source_documents USING gin(document_number gin_trgm_ops);
CREATE TABLE document_links(company_id uuid NOT NULL REFERENCES companies(id), source_id uuid NOT NULL, target_id uuid NOT NULL, relation text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,source_id,target_id,relation), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id), FOREIGN KEY(company_id,target_id) REFERENCES source_documents(company_id,id));
CREATE TABLE document_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), source_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL, old_status text, new_status text, reason text, revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id));
CREATE TABLE journal_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), branch_id uuid NOT NULL,
 source_id uuid NOT NULL, number text NOT NULL, accounting_date date NOT NULL, period_id uuid NOT NULL,
 currency char(3) NOT NULL REFERENCES currencies(code), base_currency char(3) NOT NULL REFERENCES currencies(code), exchange_rate rate_amount NOT NULL CHECK(exchange_rate>0),
 status text NOT NULL DEFAULT 'BUILDING' CHECK(status IN ('BUILDING','POSTED')), description text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), posted_by uuid NOT NULL REFERENCES users(id), posted_at timestamptz NOT NULL DEFAULT now(),
 reversal_of uuid, rule_snapshot jsonb NOT NULL DEFAULT '{}',
 UNIQUE(company_id,id), UNIQUE(company_id,source_id), UNIQUE(company_id,branch_id,number), UNIQUE(company_id,reversal_of),
 FOREIGN KEY(company_id,branch_id) REFERENCES branches(company_id,id), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id),
 FOREIGN KEY(company_id,period_id) REFERENCES financial_periods(company_id,id), FOREIGN KEY(company_id,reversal_of) REFERENCES journal_entries(company_id,id)
);
CREATE TABLE journal_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), journal_id uuid NOT NULL, line_no integer NOT NULL CHECK(line_no>0), account_id uuid NOT NULL,
 debit money_amount NOT NULL DEFAULT 0, credit money_amount NOT NULL DEFAULT 0,
 base_debit money_amount NOT NULL DEFAULT 0, base_credit money_amount NOT NULL DEFAULT 0,
 description text NOT NULL DEFAULT '', dimensions jsonb NOT NULL DEFAULT '{}', created_by uuid NOT NULL REFERENCES users(id),
 UNIQUE(company_id,id), UNIQUE(company_id,journal_id,line_no), FOREIGN KEY(company_id,journal_id) REFERENCES journal_entries(company_id,id), FOREIGN KEY(company_id,account_id) REFERENCES accounts(company_id,id),
 CHECK((debit>0 AND credit=0) OR (credit>0 AND debit=0)), CHECK((base_debit>0 AND base_credit=0) OR (base_credit>0 AND base_debit=0)), CHECK((debit>0)=(base_debit>0))
);
CREATE INDEX journal_gl ON journal_lines(company_id,account_id,journal_id);
CREATE TABLE idempotency_keys(company_id uuid NOT NULL REFERENCES companies(id), actor_id uuid NOT NULL REFERENCES users(id), command text NOT NULL, key text NOT NULL CHECK(length(key) BETWEEN 8 AND 128), request_hash text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,actor_id,command,key));
CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), actor_id uuid NOT NULL REFERENCES users(id), initiated_by uuid REFERENCES users(id), action text NOT NULL, module text NOT NULL, entity_type text NOT NULL, entity_id uuid, source_id uuid, request_id uuid NOT NULL, session_id uuid REFERENCES sessions(id), ip inet, device text, old_values jsonb, new_values jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id));
CREATE INDEX audit_filter ON audit_logs(company_id,actor_id,created_at);
CREATE TABLE outbox_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), source_id uuid NOT NULL, event_type text NOT NULL, event_version integer NOT NULL DEFAULT 1, payload jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), available_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, attempts integer NOT NULL DEFAULT 0, last_error text, lease_until timestamptz, UNIQUE(company_id,source_id,event_type,event_version), FOREIGN KEY(company_id,source_id) REFERENCES source_documents(company_id,id));

CREATE FUNCTION actor_uuid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.actor_id',true),'')::uuid $$;
CREATE FUNCTION company_uuid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.company_id',true),'')::uuid $$;
CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER event_immutable BEFORE UPDATE OR DELETE ON document_events FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER links_immutable BEFORE UPDATE OR DELETE ON document_links FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER login_immutable BEFORE UPDATE OR DELETE ON login_history FOR EACH ROW EXECUTE FUNCTION deny_mutation();

CREATE FUNCTION source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c companies%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'sources cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM companies WHERE id=NEW.company_id;
 IF actor_uuid() IS NULL THEN RAISE EXCEPTION 'actor context required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.created_by<>actor_uuid() OR NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'invalid source creator/state' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted source immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.created_by,NEW.created_at,NEW.company_id,NEW.branch_id,NEW.document_type,NEW.document_number,NEW.original_document_id) IS DISTINCT FROM (OLD.created_by,OLD.created_at,OLD.company_id,OLD.branch_id,OLD.document_type,OLD.document_number,OLD.original_document_id) THEN RAISE EXCEPTION 'source origin immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status<>'DRAFT' AND (NEW.payload,NEW.business_date,NEW.currency,NEW.exchange_rate,NEW.description,NEW.revision) IS DISTINCT FROM (OLD.payload,OLD.business_date,OLD.currency,OLD.exchange_rate,OLD.description,OLD.revision) THEN RAISE EXCEPTION 'submitted payload immutable' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status IN ('PENDING_APPROVAL','CANCELLED')) OR (OLD.status='PENDING_APPROVAL' AND NEW.status IN ('APPROVED','REJECTED','CANCELLED')) OR (OLD.status='APPROVED' AND NEW.status IN ('POSTED','CANCELLED'))) THEN RAISE EXCEPTION 'invalid state transition' USING ERRCODE='23514'; END IF;
  IF NEW.updated_by IS DISTINCT FROM actor_uuid() THEN RAISE EXCEPTION 'invalid update actor' USING ERRCODE='23514'; END IF;
  IF OLD.approved_by IS NOT NULL AND (NEW.approved_by,NEW.approved_at) IS DISTINCT FROM (OLD.approved_by,OLD.approved_at) THEN RAISE EXCEPTION 'approval immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='APPROVED' AND (NEW.approved_by IS DISTINCT FROM actor_uuid() OR (c.independent_approval AND NEW.created_by=NEW.approved_by)) THEN RAISE EXCEPTION 'independent approval required' USING ERRCODE='23514'; END IF;
 IF NEW.status='POSTED' AND (NEW.posted_by IS DISTINCT FROM actor_uuid() OR (c.independent_posting AND (NEW.posted_by=NEW.created_by OR NEW.posted_by=NEW.approved_by))) THEN RAISE EXCEPTION 'independent posting required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_integrity BEFORE INSERT OR UPDATE OR DELETE ON source_documents FOR EACH ROW EXECUTE FUNCTION source_guard();

CREATE FUNCTION journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p financial_periods%ROWTYPE; s source_documents%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND OLD.status='POSTED') THEN RAISE EXCEPTION 'posted journal immutable' USING ERRCODE='23514'; END IF;
 IF NEW.created_by IS DISTINCT FROM actor_uuid() OR NEW.posted_by IS DISTINCT FROM actor_uuid() THEN RAISE EXCEPTION 'journal actor mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM financial_periods WHERE company_id=NEW.company_id AND id=NEW.period_id FOR SHARE;
 IF NOT FOUND OR p.status<>'OPEN' OR NEW.accounting_date NOT BETWEEN p.starts_on AND p.ends_on THEN RAISE EXCEPTION 'period not open' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM source_documents WHERE company_id=NEW.company_id AND id=NEW.source_id;
 IF s.id IS NULL OR s.status NOT IN ('APPROVED','POSTED') OR s.branch_id<>NEW.branch_id OR s.business_date<>NEW.accounting_date OR s.currency<>NEW.currency OR s.exchange_rate<>NEW.exchange_rate THEN RAISE EXCEPTION 'journal source mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.base_currency<>(SELECT base_currency FROM companies WHERE id=NEW.company_id) THEN RAISE EXCEPTION 'base currency mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_integrity BEFORE INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION journal_guard();
CREATE FUNCTION line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j journal_entries%ROWTYPE; a accounts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'journal lines immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO j FROM journal_entries WHERE company_id=NEW.company_id AND id=NEW.journal_id;
 SELECT * INTO a FROM accounts WHERE company_id=NEW.company_id AND id=NEW.account_id;
 IF j.status IS DISTINCT FROM 'BUILDING' OR NOT a.active OR NOT a.postable OR NEW.created_by IS DISTINCT FROM actor_uuid() THEN RAISE EXCEPTION 'invalid journal line' USING ERRCODE='23514'; END IF;
 IF a.currency IS NOT NULL AND a.currency<>j.currency THEN RAISE EXCEPTION 'account currency mismatch' USING ERRCODE='23514'; END IF;
 IF j.currency=j.base_currency AND (j.exchange_rate<>1 OR NEW.debit<>NEW.base_debit OR NEW.credit<>NEW.base_credit) THEN RAISE EXCEPTION 'base values mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_line_integrity BEFORE INSERT OR UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION line_guard();
CREATE FUNCTION journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j journal_entries%ROWTYPE; n bigint; d numeric; b numeric;
BEGIN
 SELECT * INTO j FROM journal_entries WHERE id=NEW.id;
 SELECT count(*),coalesce(sum(debit-credit),0),coalesce(sum(base_debit-base_credit),0) INTO n,d,b FROM journal_lines WHERE company_id=j.company_id AND journal_id=j.id;
 IF j.status<>'POSTED' OR n<2 OR d<>0 OR b<>0 THEN RAISE EXCEPTION 'unsealed or unbalanced journal' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM source_documents WHERE id=j.source_id AND status='POSTED' AND posted_by=j.posted_by) THEN RAISE EXCEPTION 'journal source not posted' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balance_commit AFTER INSERT OR UPDATE ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_balanced();
CREATE FUNCTION posted_source_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='POSTED' AND NOT EXISTS(SELECT 1 FROM journal_entries WHERE company_id=NEW.company_id AND source_id=NEW.id AND status='POSTED') THEN RAISE EXCEPTION 'posted source requires journal' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER source_commit AFTER UPDATE ON source_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION posted_source_complete();

-- All company-scoped tables receive RLS; owner migration role is separate from runtime.
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='company_id' LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t.table_name);
  EXECUTE format('CREATE POLICY company_isolation ON %I USING (company_id=company_uuid()) WITH CHECK (company_id=company_uuid())',t.table_name);
 END LOOP;
END $$;
COMMIT;
