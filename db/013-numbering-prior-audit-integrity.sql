BEGIN;
CREATE OR REPLACE FUNCTION numbering_request_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action_name text; expected_before jsonb;
BEGIN
 IF current_user<>'erp_runtime' THEN RETURN NULL; END IF;
 action_name=CASE NEW.state WHEN 'PENDING' THEN 'NUMBERING_CHANGE_PROPOSE' WHEN 'APPLIED' THEN 'NUMBERING_CHANGE_APPROVE' ELSE 'NUMBERING_CHANGE_REJECT' END;
 expected_before=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD) END;
 IF NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='NUMBERING_CONFIGURATION' AND entity_id=NEW.id AND actor_id=actor_uuid() AND created_at=now() AND action=action_name AND new_values->'after'=to_jsonb(NEW) AND new_values->'before'=expected_before) THEN RAISE EXCEPTION 'numbering request requires exact atomic before/after audit' USING ERRCODE='23514'; END IF;
 IF NEW.state='APPLIED' AND NOT EXISTS(SELECT 1 FROM document_numbering_policies WHERE company_id=NEW.company_id AND id=NEW.result_policy_id AND last_request_id=NEW.id AND version=NEW.expected_version+1 AND prefix=NEW.prefix AND padding=NEW.padding) THEN RAISE EXCEPTION 'numbering publication must be atomic with review' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION approved_numbering_audited() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_before jsonb;
BEGIN
 expected_before=CASE WHEN TG_OP='INSERT' THEN 'null'::jsonb ELSE to_jsonb(OLD) END;
 IF current_user='erp_runtime' AND NOT EXISTS(SELECT 1 FROM audit_logs WHERE company_id=NEW.company_id AND entity_type='NUMBERING_CONFIGURATION' AND entity_id=NEW.last_request_id AND actor_id=actor_uuid() AND created_at=now() AND action='NUMBERING_CHANGE_APPROVE' AND new_values->'policyAfter'=to_jsonb(NEW) AND new_values->'policyBefore'=expected_before) THEN RAISE EXCEPTION 'numbering mutation requires exact atomic before/after audit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
COMMIT;
