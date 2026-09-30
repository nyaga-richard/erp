BEGIN;
CREATE FUNCTION worker_audit_origin_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='erp_auth_worker' THEN
  IF NEW.actor_id<>'00000000-0000-4000-8000-000000000001'::uuid OR NEW.action<>'RESET_DELIVERY' OR NEW.outcome NOT IN ('SUCCESS','FAILED') OR NEW.company_id IS NOT NULL OR NEW.session_id IS NOT NULL THEN RAISE EXCEPTION 'mail worker audit origin must be the authentication service' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth_delivery_outbox WHERE id::text=NEW.details->>'jobId' AND user_id=NEW.subject_user_id) OR coalesce(NEW.details->>'adapter','') NOT IN ('file','smtp') OR (NEW.details-ARRAY['jobId','adapter'])<>'{}'::jsonb THEN RAISE EXCEPTION 'mail worker audit requires a matching delivery job and adapter' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER worker_audit_origin BEFORE INSERT ON security_events FOR EACH ROW EXECUTE FUNCTION worker_audit_origin_guard();
COMMIT;
