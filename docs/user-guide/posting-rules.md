# Posting-rule configuration

Status: VERIFIED for the released company/branch/warehouse configuration workflow. Operational use of the mappings remains IN_PROGRESS.

## Try it in the development preview

1. Sign in as **Esther (`admin@demo.local`)**, using the private development password in `DEMO_ACCESS.md`.
2. Open **Control center → Posting rules → Propose posting rule**.
3. Select a registered event: GOODS_RECEIVED, STOCK_LOSS or STOCK_GAIN. These are configuration contracts, not enabled stock transaction screens.
4. Set inclusive effective dates and integer priority. Leave branch blank for a company-wide mapping, or search/select an active branch and optionally one of its warehouses.
5. Search for an eligible account for every symbolic leg. The server supplies debit/credit direction and amount key; you cannot enter a formula or financial total. Only active postable accounts with the right classification/control type and functional denomination are offered.
6. Enter a reason and submit. The request is pending; it does not create a published rule, journal, stock movement, tax entry or balance change.
7. Sign out, then sign in as **Felix (`reviewer@demo.local`)**. Open **Rule requests**, inspect the proposed bindings/creator/reason, and approve or reject with an independent review reason. The maker cannot decide their own request even if granted both permissions.
8. Inspect **Published rules** and **Effective lookup**. Lookup shows which rule wins for an event/date/branch/optional warehouse, or a visible missing/ambiguous result. This is an informational preview, not a reservation or authorization to post.

Accounts and priorities in browser-created DEMO requests are test configurations, not accountant-approved production policy. No real inventory transaction is posted by this screen.

## Priority and effective dates

Higher priority wins; at equal priority, the more specific scope wins. Equal-rank overlapping scopes/dates are rejected. Mapping revision numbers do not break ties. End dates are inclusive. Account and scope availability is checked again during approval under the configuration lock, so a stale proposal may be refused without partial publication.

## Retirement and corrections

Published definitions and account bindings cannot be edited/deleted. For replacement, propose a new version with a deliberate scope/priority/effective period. **Propose retirement** requests an inclusive prospective end, reviewed by another user. It must shorten current coverage, cannot precede today or the rule start, and must not invalidate any retained journal-application date. Retirement records are append-only and versioned. Competing stale retirement requests must be rejected and reproposed; old definitions are not silently resurrected.

Pending requests can be rejected without changing mappings. Terminal decisions are immutable. History includes creator, reviewer, timestamps, reasons and selected accounts; the audit trail retains exact SQL-native before/after and publication/retirement snapshots.

## Permissions and current boundaries

- `rules:view`: configuration catalog/history/effective lookup and eligible account/scope search. It does not grant ledger balances or journal access.
- `rules:propose`: create mapping/retirement proposals.
- `rules:approve`: independently decide requests.
- Administrative role names have no special authority. Use role permission configuration to delegate these capabilities.
- Account/branch/warehouse results and requests use bounded server search/pagination. Dialogs support keyboard selection, focus restoration, Escape, mobile and dark mode.
- Product/category/tax/payment selectors are not yet accepted by this configuration API. Their masters and operational services remain unfinished.
- The journal-application reference table is read-only to the runtime until operational rule posting is integrated. No actual stock/AR/AP/tax posting or subledger reconciliation is claimed by this configuration release.
