# Reviewed product/SKU registration and assignment boundaries

Status: VERIFIED for independently reviewed initial registration only. Product lifecycle, price/profile amendments and inventory operations remain IN_PROGRESS or NOT_STARTED in the live matrix. Reuse the verified references and existing engines.

## Reuse and sequence

Reuse governed units/categories/brands (migration016), reviewed tax masters/schedules (015), existing `products`, `product_barcodes`, `product_taxes`, `product_prices`, money/quantity domains and CommandService. Design normalized versioned changes before coding. Continue with product creation/read/search, controlled metadata/pricing/tax-assignment changes and barcode uniqueness; only then movement-only inventory and weighted-average costing. Do not expose quantity-on-hand or derived stock valuation as editable master fields.

## Decisions that must be explicit

- SKU and product-code uniqueness and normalization, barcode text preserving leading zeros, exact-match barcode fast lookup plus bounded name/SKU search. Concurrent creation must not duplicate identities.
- Required governed category and base unit, optional governed brand. Supplier dependency remains separate until supplier masters exist. Legacy owner-created placeholders must not silently become operational products.
- STOCK/SERVICE/NON_STOCK semantics. Batch/serial/expiry options must be rejected or visibly unavailable until their operational invariants exist; serialized quantities must respect indivisible units.
- Product prices use exact six-place strings compatible with numeric(20,6), with explicit currency and price mode policy. Separate commercial reference prices from inventory valuation. **Do not round-trip SQL JSON numeric prices through JavaScript Number:**20 significant digits can lose precision. Use SQL-native audit assembly or canonical decimal-string snapshots, and test the maximum supported value.
- Product category classification and tax IDs need dated authoritative assignments. A mutable current `products.tax_category_id` alone cannot resolve historical tax correctly. Design effective-dated classification/assignment history, uniqueness/overlap and independent review before allowing taxable products to become operational. Preview must not authorize posting; missing applicable schedules fail closed.
- Product/price/tax changes preserve original actor, reviewer where required, time, reason and immutable history; optimistic versions prevent lost updates. Original posted sale/return snapshots must not reinterpret current product metadata, rates or prices.
- Create product, barcode/assignment children, exact audit and idempotency result atomically. Deliberate child/audit failures must roll back every local effect. No opening stock, journal, customer/supplier balance or tax register is created by master-data registration.

## Original test-first plan (executed for initial registration)

Add isolated DB/HTTP acceptance tests before migration017/service: authentication/RBAC/tenant/strict body, foreign or legacy references, exact quantity/price bounds, forbidden balance/actor fields, duplicate SKU/code/barcode races, leading-zero barcode preservation, coherent dated tax assignment, inactive account/reference revalidation where applicable, immutable/optimistic changes, exact large-decimal audit and rollback/retry. Reuse existing engines rather than introducing another ledger/tax calculator. Verify backend before adding the product screen; then real browser creation/search/barcode/least-privilege/mobile/dark and full regression. Fresh encrypted backup and actual restoration are required before marking the slice verified.

## Current slice design decision — 29 September

Implement independently reviewed **initial registration**, not direct product mutation. PENDING→APPLIED/REJECTED requests store typed initial prices, references, a finite initial tax profile and normalized proposed tax/barcode children. All publications occur atomically in the independent review transaction. Use `products:propose/approve` separately from reference-management authority; approving initial prices also requires `products:cost:view`. Ordinary `products:view` catalogs/history mask purchase cost. Seeded administration/reviewer receive explicit grants; no role-name checks.

Products retain immutable initial commercial prices in company functional currency and explicit INCLUSIVE/EXCLUSIVE mode. A separate immutable finite `product_tax_profiles` record captures dated classification; existing `product_taxes` rows link tax IDs to that profile and its exact interval. Do not resolve from the current header alone. Approval requires full interval coverage by reviewed compatible same-base rate schedules, not merely a rate on the first day. Exempt/non-taxable profiles require no taxes and exclusive mode. Dated profile amendment, commercial price revisions and operational tax posting remain subsequent work; never create an overlapping replacement silently.

Initial barcodes refer only to the base UOM and remain text. Governed products/children cannot be mutated or extended after publication. SKU/product codes use explicit uppercase ASCII identity policy; printable no-space barcodes retain case and leading zeros. Batch/serial/expiry, alternative UOMs, supplier linkage, reorder/balance fields and operational posting are not accepted in this registration body.

Add product catalog/detail/search, exact barcode lookup, request history, proposal/decision and a server-price tax preview. Reuse the configured tax calculation path inside the same read transaction; do not create another calculator or forward frontend factors. Preview is informational and fails outside the retained profile/schedules. Exact numeric(20,6) prices travel as strings; SQL assembles audit snapshots without JavaScript numeric round trips. Existing target-schema legacy products stay excluded from governed catalogs.


## Executed evidence and limits

Migration017, `product-configuration.ts` and `Products.tsx` implement this initial contract. Backend product suite:17 tests including parent, within214 passing backend tests. Real browser registration/review/search/barcode/preview and restricted-reader-with-audit suites pass, alongside all15 earlier browser suites. Maximum99999999999999.999999 prices survive native SQL audits and authorized API audit projections exactly. Product audit snapshots are redacted without current `products:cost:view`; generic audit authority alone cannot bypass cost visibility. Original database audits remain intact.

Inspection found and fixed audit-route cost exposure and JSON-number precision loss; expected RED and final GREEN evidence are retained. Mobile/dark screenshots were inspected; dialog errors now clear on dismissal instead of leaking into the catalog. SQL publication, duplicate barcode races, schedule gaps, stale tax accounts and deliberate audit/child failures are covered. No stock or financial effects arise from registration. Actual encrypted restoration: `../testing/product-registration-restoration.json` (17 migrations, two registered products, four barcodes, exact native publication audits, zero stock movements).

Seven routes across six OpenAPI paths expose catalog/detail/lookup, request list/propose/decide and server-price preview. UI: Control center → Products. Initial registration is immutable; there is no product/price/profile correction or retirement command, supplier linkage, alternate-unit barcode, stock availability, valuation posting or sales flow. Continue with the stock transaction contract in `weighted-average-contract.md`; do not mistake its arithmetic kernel for movement posting.
