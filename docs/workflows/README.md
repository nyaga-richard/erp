# Released workflows and boundaries

## Manual journal

1. Authorized creator selects an assigned active branch, open-business context and active non-control posting accounts; amounts are decimal strings.
2. Draft creation allocates a source number and writes source/event/audit atomically. A maker may revise their unposted source with optimistic revision checks; old revisions remain attributable.
3. Submit evaluates the configured approval policy. Another authorized reviewer approves or rejects. The system never trusts actor IDs from the browser.
4. An authorized poster, separate when policy requires, rechecks period, accounts, permissions and immutable approval snapshot. One database transaction seals a balanced journal, links source, stores outbox/event/audit and advances the source state.
5. General Ledger/trial balance and source→journal→audit drilldown derive from the posted entries. Correcting a posted journal requires a separately reviewed linked reversal; deletion and direct edits are refused.

Duplicate command keys return the original result only when the canonical payload matches. Conflicting payloads, concurrent state transitions, self-approval/posting violations, invalid accounts and period failures roll back financial effects. Numbering is part of that same transaction, not a separate durable side effect.

## Account configuration

Control center → Account controls supports CREATE and versioned RENAME proposals. The creator cannot approve their own request; the reviewer must hold the explicit approval grant. An approved account becomes selectable in the journal editor and participates in the same workflow above. Configuration itself changes no balances. Account code/classification/control status/currency/parent/deactivation/opening-balance administration is not yet released.

## Organization and access

Company legal/display/contact settings, branch configuration, warehouse configuration, membership/branch scopes, delegated roles, approval-policy publication and session/reset administration use their existing permissioned screens. Active dependencies conservatively block location closure. Company creation/multi-company onboarding is not implied by the company-settings editor.

## Not released

Purchasing→GRN→AP, stock movements/valuation, POS/cashier sessions, AR, payments/allocations/M-Pesa, sales/supplier returns, expenses/cash reconciliation, tax registers/eTIMS and full financial statements are unfinished. The pure tax calculator and schema baseline must not be presented as those completed workflows. Their required atomic accounting/inventory/tax effects remain tracked in REQUIREMENTS_MATRIX.md. The user's final reconciled operational scenario has not been executed because these dependencies do not yet exist.
