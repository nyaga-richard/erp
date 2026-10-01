BEGIN;

-- One-time ledger for the safe starter scaffold. Only the migration/owner role
-- can read or write it; the application cannot replay or erase the setup.
CREATE TABLE production_company_scaffolds (
 company_id uuid NOT NULL REFERENCES companies(id),
 template_code text NOT NULL CHECK (template_code='STARTER_V1'),
 completed_by uuid NOT NULL REFERENCES users(id),
 request_id uuid NOT NULL UNIQUE,
 completed_at timestamptz NOT NULL DEFAULT now(),
 details jsonb NOT NULL,
 PRIMARY KEY(company_id,template_code)
);
ALTER TABLE production_company_scaffolds ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER production_company_scaffold_immutable
 BEFORE UPDATE OR DELETE ON production_company_scaffolds
 FOR EACH ROW EXECUTE FUNCTION deny_mutation();
REVOKE ALL ON production_company_scaffolds FROM PUBLIC, erp_runtime, erp_auth_worker;

COMMIT;
