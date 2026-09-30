# API usage and scope

[openapi.json](../openapi.json) describes implemented routes only. Business API base is `/api/v1`; operational `/api/health`, `/api/health/live` and `/api/health/ready` override that base to the server root. Legacy `/api/v1/health` now delegates to readiness. A health success does not set productionReady true.

Browser requests are same-origin through Next's private proxy. Login uses actual password credentials and establishes an HttpOnly cookie plus CSRF token. Private requests include X-Company-ID; membership/branch/permission checks are server-side. Financial/configuration POST commands also use an Idempotency-Key for exact retries. Amounts are decimal strings. Do not send actor IDs, server state, balances, posting status, tax rates or financial account mappings as authority from a UI.

The optional development memory transport negotiates X-ERP-Session-Transport: memory and sends its returned credential in X-ERP-Session instead of relying on cookies. It retains CSRF and server-session checks, is never persisted, and is forbidden in production. OpenAPI documents both modes without suggesting that production should accept the preview mode.

Validation errors expose field paths/messages; integrity, permission, state/version and idempotency failures fail closed. Responses include a generated request ID. No SQL, password, session/reset token or stack trace is returned in an error. Search endpoints paginate; page limits and filters are validated.

The exact-decimal tax kernel and number allocator are internal dependencies, not public calculation/configuration endpoints. Inventory, sales/POS, purchasing, AR/AP/payment/return/expense and provider-posting APIs are not released. Stable detailed projection schemas remain a gate where the current OpenAPI uses Record; no complete API-contract claim is made merely because route documentation exists.

Regenerate the specification with `python scripts/generate-openapi.py`; regeneration must accompany route changes and cannot replace actual route/security tests.
