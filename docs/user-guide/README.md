# Current workspace guide

This guide covers working foundation screens, **not a finished operational ERP**. Use the private DEMO_ACCESS file generated in your own development environment for test identities; production releases do not contain shared credentials.

## Sign in and company scope

Use the live preview's sign-in form. Choose an authorized company; only assigned branches can be used for financial entries. Permissions are enforced on the server even when a control is hidden. In the Arena development memory-session mode, reload requires a new sign-in; that is intentional. Production uses secure cookies instead. Wait for “Checking session…” to finish before typing. A tab without the matching anti-CSRF context (or with stale context) asks for a fresh password sign-in; it does not silently enter a workspace with unusable commands.

## Journal lifecycle

Open the journal editor, select the branch/date and search the chart for active non-control posting accounts. Enter decimal debit/credit amounts and a meaningful description. The draft must balance. Save, review and submit. A different authorized reviewer approves; an independently authorized poster posts according to the selected policy. The source detail shows who created, edited, approved and posted it, with linked journal/audit history.

After posting, use General Ledger/trial-balance views and source drilldown to inspect effects. Do not edit a posted entry. Request a linked reversing source and repeat independent review/posting where a reversal is appropriate. Current reports are the accounting core, not full financial statements or operational reconciliation.

## Control center

- **People / Roles / Sessions:** manage delegated company access, branch scope, permissions and session revocation within your grants. Role names do not grant powers by themselves.
- **Approval policies:** propose and independently publish supported journal policies; users cannot approve their own publication or bypass transaction actor separation.
- **Company / Branches / Warehouses:** maintain the released settings. Codes/hierarchy have documented immutable boundaries. Active warehouses/unposted dependencies can block closure; resolve them rather than forcing a status flag.
- **Account controls:** search the full paginated chart; propose a non-control account or a versioned name correction. Reviewers inspect the pending request and approve or reject with a reason. Pending requests do not create usable accounts. Historical balances and entry IDs are unaffected by renaming.
- **Numbering:** select Numbering in Control center. Search published formats or change requests. A proposer chooses an active branch, released document type and calendar year; the effective preview distinguishes defaults from an approved override. Submit a prefix/digit-width proposal with a reason. A different authorized reviewer approves or rejects it. Requests do not allocate numbers. Once any number has been allocated, that format is locked permanently, including after cancellation. You cannot reset a counter, reuse a number or renumber an existing source. A role with only `workspace:view` and `numbering:view` can inspect this screen without finance/proposal powers.
- **Security/recovery:** inspect authorized events, change your password, request a reset and revoke sessions. Development reset delivery is a private file adapter, not email.

Searches have loading/empty/error states. Configuration forms require meaningful reasons; validation failures leave no partial financial posting. Escape closes supported dialogs when not saving. Light/dark mode and a 390px navigation layout are exercised by browser tests.

## Unavailable workflows

Do not use this foundation for live checkout, stock, purchasing, AR/AP, operational payments/M-Pesa, returns, expenses, statutory tax filing/eTIMS or full financial reporting yet. Those modules remain unfinished and their controls must not be simulated with editable balances or fake successful transactions. Follow the live implementation ledger for precisely scoped progress.

## Exact amounts and sandbox recovery

Amounts now preserve server decimal strings without binary rounding; malformed/overprecision values show “Invalid amount”, not an invented zero. Draft business dates use Africa/Nairobi. The September29 sandbox was restored from an older checkpoint; later original demo history was lost. New test documents are new demo transactions, not reconstructed history. Never use this preview for real financial operations; see ../backups/sandbox-recovery-20260929.md.
