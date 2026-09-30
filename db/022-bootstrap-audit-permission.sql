BEGIN;

-- Production bootstrap grants the initial administrator read-only audit access.
-- The API has required audit:view since the audit route was introduced, but the
-- permission was missing from the seeded catalog. Apply forward-only so existing
-- installations receive the same permission during their next reviewed deploy.
INSERT INTO permissions(code, description)
VALUES ('audit:view', 'View company audit log entries')
ON CONFLICT (code) DO NOTHING;

COMMIT;
