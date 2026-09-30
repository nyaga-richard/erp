BEGIN;
CREATE POLICY own_memberships ON memberships FOR SELECT USING(user_id=actor_uuid());
CREATE FUNCTION audit_actor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF actor_uuid() IS NULL OR NEW.actor_id<>actor_uuid() OR NEW.company_id<>company_uuid() THEN RAISE EXCEPTION 'audit actor mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_actor BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_actor_guard();
CREATE TRIGGER event_actor BEFORE INSERT ON document_events FOR EACH ROW EXECUTE FUNCTION audit_actor_guard();
CREATE FUNCTION manual_control_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM journal_entries j JOIN source_documents s ON s.id=j.source_id JOIN accounts a ON a.id=NEW.account_id WHERE j.id=NEW.journal_id AND s.document_type IN ('MANUAL_JOURNAL','JOURNAL_REVERSAL') AND a.control_type IS NOT NULL) THEN RAISE EXCEPTION 'manual entry to control account forbidden' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER manual_controls BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION manual_control_guard();
CREATE FUNCTION journal_audited() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND source_id=NEW.source_id AND action='POST' AND actor_id=NEW.posted_by) THEN RAISE EXCEPTION 'posting requires audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_audit_commit AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_audited();
CREATE FUNCTION account_tree_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND EXISTS(WITH RECURSIVE parents AS (SELECT id,parent_id FROM accounts WHERE id=NEW.parent_id UNION ALL SELECT a.id,a.parent_id FROM accounts a JOIN parents p ON a.id=p.parent_id) SELECT 1 FROM parents WHERE id=NEW.id) THEN RAISE EXCEPTION 'account hierarchy cycle' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM journal_lines WHERE account_id=OLD.id) AND (NEW.company_id,NEW.account_type,NEW.control_type,NEW.currency) IS DISTINCT FROM (OLD.company_id,OLD.account_type,OLD.control_type,OLD.currency) THEN RAISE EXCEPTION 'used account classification immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_tree BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION account_tree_guard();
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='erp_runtime') THEN CREATE ROLE erp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM erp_runtime;
GRANT USAGE ON SCHEMA public TO erp_runtime;
GRANT SELECT ON users,companies,currencies,memberships,branches,warehouses,roles,permissions,role_permissions,user_roles,user_branch_scopes,accounts,financial_periods,source_documents,journal_entries,journal_lines,document_events,document_links,audit_logs,document_sequences,idempotency_keys,sessions,login_history TO erp_runtime;
GRANT INSERT ON sessions,login_history,source_documents,journal_entries,journal_lines,document_events,document_links,audit_logs,document_sequences,idempotency_keys,outbox_events TO erp_runtime;
GRANT UPDATE ON document_sequences,idempotency_keys TO erp_runtime;
GRANT UPDATE(status,updated_by,updated_at,approved_by,approved_at,posted_by,posted_at) ON source_documents TO erp_runtime;
GRANT UPDATE(status) ON journal_entries TO erp_runtime;
GRANT UPDATE(status,updated_by,updated_at) ON financial_periods TO erp_runtime;
GRANT UPDATE(revoked_at,last_seen_at) ON sessions TO erp_runtime;
GRANT UPDATE(failed_logins,locked_until) ON users TO erp_runtime;
-- PostgreSQL row locks require UPDATE privilege on at least one column.
GRANT UPDATE(active) ON accounts TO erp_runtime;
COMMIT;
