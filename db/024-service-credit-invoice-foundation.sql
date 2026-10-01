BEGIN;

-- First bounded source contract: one-line, functional-currency SERVICE credit
-- invoices. This registers authority only; no tax rate or account mapping is
-- supplied by the migration, and the operational posting route is still gated.
INSERT INTO permissions(code,description) VALUES
 ('customer-invoices:view','Read authorized service credit invoice drafts and submitted financial valuations'),
 ('customer-invoices:credit:view','Read snapshotted customer credit-policy fields on service credit invoices'),
 ('customer-invoices:create','Create inert service credit invoice drafts'),
 ('customer-invoices:submit','Submit service credit invoice drafts for independent review'),
 ('customer-invoices:approve','Independently approve or reject service credit invoices'),
 ('customer-invoices:post','Post approved service credit invoices'),
 ('customer-invoices:cancel','Cancel unposted service credit invoice drafts'),
 ('customer-invoices:reverse','Create a linked full original-value service credit invoice reversal')
ON CONFLICT DO NOTHING;

-- Uses the existing controlled-number allocator with a migration-owned fallback
-- format. Companies may replace it through the reviewed numbering workflow.
INSERT INTO document_numbering_defaults(document_type,prefix,padding)
VALUES('SERVICE_CREDIT_INVOICE','SCI',6)
ON CONFLICT(document_type) DO NOTHING;

INSERT INTO posting_event_contracts(event_type,contract_version,origin_migration)
VALUES('SERVICE_CREDIT_INVOICE',1,'024-service-credit-invoice-foundation.sql');
INSERT INTO posting_event_leg_contracts(event_type,contract_version,leg_code,side,amount_key) VALUES
 ('SERVICE_CREDIT_INVOICE',1,'AR','DEBIT','gross'),
 ('SERVICE_CREDIT_INVOICE',1,'REVENUE','CREDIT','net'),
 ('SERVICE_CREDIT_INVOICE',1,'OUTPUT_TAX','CREDIT','tax');
INSERT INTO posting_event_leg_eligibility(event_type,contract_version,leg_code,account_type,control_type) VALUES
 ('SERVICE_CREDIT_INVOICE',1,'AR','ASSET','AR'),
 ('SERVICE_CREDIT_INVOICE',1,'REVENUE','REVENUE',NULL),
 ('SERVICE_CREDIT_INVOICE',1,'OUTPUT_TAX','LIABILITY','TAX');
UPDATE posting_event_contracts SET sealed_at=now()
WHERE event_type='SERVICE_CREDIT_INVOICE' AND contract_version=1;

COMMIT;
