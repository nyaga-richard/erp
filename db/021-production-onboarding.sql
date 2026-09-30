BEGIN;

-- Immutable register makes the production first-tenant bootstrap a one-time operation.
-- No application role receives privileges on this table.
CREATE TABLE production_onboarding (
 singleton smallint PRIMARY KEY CHECK (singleton = 1),
 company_id uuid NOT NULL UNIQUE REFERENCES companies(id),
 branch_id uuid NOT NULL,
 initial_admin_id uuid NOT NULL,
 completed_by uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL UNIQUE,
 completed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (company_id, branch_id) REFERENCES branches(company_id, id),
 FOREIGN KEY (company_id, initial_admin_id) REFERENCES memberships(company_id, user_id)
);
ALTER TABLE production_onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_onboarding_company_scope ON production_onboarding
 USING (company_id = company_uuid()) WITH CHECK (company_id = company_uuid());
CREATE TRIGGER production_onboarding_immutable
 BEFORE UPDATE OR DELETE ON production_onboarding
 FOR EACH ROW EXECUTE FUNCTION deny_mutation();
REVOKE ALL ON production_onboarding FROM PUBLIC, erp_runtime, erp_auth_worker;

COMMIT;
