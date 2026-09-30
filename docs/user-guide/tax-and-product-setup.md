# Tax configuration and product setup

Development workflows are available in **Control center**. Use the existing private password in `DEMO_ACCESS.md`; no credentials were reset for this work.

## Tax configuration

1. Sign in as **Esther (`admin@demo.local`)** and open **Tax configuration**.
2. Choose **Propose tax configuration → Tax definition**. Enter the code/name/type, documentary basis and reason.
3. Propose a **Tax category**, explicitly choosing TAXABLE, ZERO_RATED, EXEMPT or NON_TAXABLE. These classifications are not interchangeable.
4. Sign in as **Felix (`reviewer@demo.local`)**, open **Tax requests**, inspect each proposal and independently approve or reject it. Makers cannot approve their own requests, including when granted both permissions.
5. Esther can then propose an **Effective rate schedule** using the reviewed tax and category. Enter both inclusive dates, an exact fractional rate, price mode and recoverable fraction. Search/select eligible input ASSET/TAX and output LIABILITY/TAX accounts. Review and publish as Felix.
6. **Calculation preview** accepts a reviewed category, explicitly selected tax IDs, date, quantity, price and discount. It resolves effective schedules on the server and uses the exact existing calculator. A missing schedule is an error, not a zero-tax fallback. Exempt/non-taxable previews require no selected taxes.

A rate factor is not a percentage number: **1 means100%**. Enter the documented fractional factor, not an assumed statutory default. Recoverability is between0 and1. The preview shows net/tax/gross, recoverable/nonrecoverable amounts and selected rate IDs. All selected taxes use the same net base; compound and fixed-unit calculations are unsupported.

Published schedules are immutable and finite-dated. Non-overlapping adjacent schedules are supported; overlapping schedules are refused, including concurrent approvals. **Retirement, shortening and amendment are not yet supported.** Do not publish an unnecessarily long interval: the existing database exclusion remains in force. The documentary basis is preserved but not independently certified. Browser-created DEMO schedules are labeled calculation fixtures, not legal/accountant acceptance.

Permissions: `taxes:view`, `taxes:propose`, `taxes:approve`. Tax-only readers do not receive ledger balances or proposal powers. No tax register, journal, stock movement, filing or eTIMS submission is produced by this screen.

## Product setup

Open **Control center → Product setup** as Esther.

- **Units**: create an uppercase code/name and quantity precision0–6. Zero means whole units, not a stock balance.
- **Categories**: create a root category or search/select an existing same-company parent. Cycles are refused and depth is limited to20 levels.
- **Brands**: create a company-scoped brand name.

Every creation requires a reason and commits an exact audit record with its actual creator. Metadata is immutable in this initial workflow; unit precision/parent relationships cannot be edited or deleted. Metadata creation itself has no monetary approval threshold because it changes no financial value or balance. Lifecycle/correction workflows are still pending.

Permissions: `products:view` for search/read, `products:manage` for reference creation. Felix can inspect the catalogs but cannot create records. Both catalogs and parent selectors use bounded server search/pagination. Mobile tables keep wide columns in their own scroll container.

## Products: reviewed initial SKU registration

1. Open **Control center → Products** as Esther and choose **Propose product**.
2. Enter unique uppercase SKU/product code and a name. Select STOCK, SERVICE or NON_STOCK, then search for a governed category/base unit and optional brand. Create missing references in Product setup first.
3. Enter exact nonnegative purchase and selling reference prices (maximum14 integer and6 fractional digits). Currency comes from the company. Select inclusive/exclusive mode; these are initial commercial references, **not stock valuation**.
4. Select a reviewed tax category, add the explicit tax IDs for taxable/zero-rated products, and enter both profile dates. Reviewed compatible schedules must cover the entire interval. Exempt/non-taxable profiles require no taxes and exclusive mode. No statutory default is assumed.
5. Optionally enter one base-unit barcode per line (maximum20). Leading zeros and case are retained. Enter a reason and submit. This only creates a pending request.
6. As Felix, open **Product requests**, inspect the details, and independently approve or reject with a reason. Makers cannot review their own requests. Approval requires both `products:approve` and current `products:cost:view`.
7. **Published products** supports server search. **Exact barcode lookup** finds a case-sensitive text barcode. **View product** shows the original prices, provenance and finite tax profile. **Preview product tax** resolves the stored selling price/profile on the server; supply only date, quantity and discount. Missing/out-of-range profiles fail rather than assuming no tax.

`products:propose` is distinct from reference management. Readers without `products:cost:view` see Restricted purchase prices in catalog/details/history; even `audit:view` does not expose their raw cost snapshots. The underlying exact audit remains immutable.

**Still unavailable:** product/price/profile amendment or retirement, supplier linkage, alternate units, batches/serials/expiry, stock balances/movements, transfers/counts, valuation posting, purchasing and POS. The internal weighted-average arithmetic helper does not enable these workflows. No editable stock balance or opening quantity is accepted here.

## Evidence

Current backend214 tests pass, including17 product registration tests (with parent),14 tax configuration tests,9 product-reference tests and12 pure valuation tests. All17 browser suites pass. Six recovery tests and a fresh actual isolated product restoration pass. Exact receipts/build/health/limits are linked from `../EXECUTION_CHECKPOINT.md`. Production readiness remains false.
