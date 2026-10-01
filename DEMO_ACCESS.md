# Development credentials intentionally omitted

This release package does not contain demo passwords, user sessions, or database state. Do not use shared development credentials in production.

After running the development-only seed (`NODE_ENV` must not be `production`), the demo tenant includes a starter chart of accounts, prior/current/next calendar-year periods, a branch and warehouse, and governed demo product units/categories/brand references. No financial opening balances or stock balances are fabricated. The seed is synthetic test data, not a template for live accounting or tax setup.

See `docs/deployment/ubuntu-cloudflare-tunnel-trustedsystems.md` and `docs/deployment/README.md` for the production/staging setup limits.
