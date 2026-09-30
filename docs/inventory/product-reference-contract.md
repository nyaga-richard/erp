# Product reference masters — first inventory dependency

Status: VERIFIED for initial immutable creation/read/search; overall inventory IN_PROGRESS. Migration016 applied; nine DB/HTTP tests, workflow and isolated product-only browser access tests pass. Actual restoration preserved metadata and exact audit links. Lifecycle/corrections remain unfinished. This slice implements real units, product-category hierarchy and brands before product/SKU and movement services. It is not stock CRUD.

## Workflow and effects

An authenticated company member with `products:manage` creates a unit, category or brand with a reason. `products:view` reads/searches bounded catalogs without receiving ledger access. Reuse CommandService for session/permission revalidation, company configuration locking, idempotency, rollback and failed-attempt audit. Creation of reference metadata has no financial, inventory, tax, quantity or balance effect and does not require a monetary approval threshold. Future product/tax/price changes need their own explicit workflow; this permission does not authorize them.

Reuse `units_of_measure`, `product_categories`, `brands`. Add an explicit catalog version marker so legacy owner-created target-schema placeholders are not silently adopted. New governed records are immutable: no editing unit precision or category parent after use, no delete/recreate. Root/child category creation must stay in the company, reference governed parents, avoid cycles and bound hierarchy depth. Units have an integer quantity scale0–6; brands have names; units/categories have unique uppercase codes. Caller actor IDs and unknown properties are rejected. Preserve the actual creator and creation time and exact SQL-native audit in the same transaction. Published reference metadata cannot be modified even by ordinary owner statements; future lifecycle migration must preserve history.

## API and UI contract

GET `/api/v1/admin/product-references?kind=UNIT|CATEGORY|BRAND&q=&page=&limit=`; POST on the same path accepts discriminated typed creation plus reason. IDs are server generated. The Control center Product setup tab exposes separate catalogs and a creation dialog, keyboard-focus handling and category-parent server search. No stock quantities, prices, ledger accounts or tax percentages are editable here.

## Test-first gates

HTTP404 RED before implementation. Then real DB/HTTP tests for permission/tenant/CSRF/strict schema, idempotency, duplicate code/name races, inactive authority, unit scale bounds, hierarchical parent scope/depth, exact immutable audit and deliberate audit corruption rollback. Assert no product, source, journal or movement is created. Run existing regression, then browser creation/catalog/search, minimal reader, mobile/dark and focus. Backup/restoration must preserve metadata and audit. Only then start full product masters with SKU uniqueness, barcodes, reviewed tax references and exact prices; movement-only weighted-average inventory remains a separate atomic operation, not a field on the catalog editor.
