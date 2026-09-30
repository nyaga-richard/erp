import csv
from pathlib import Path
titles='''Core design principle
Mandatory user attribution
System-generated transactions
Multi-company architecture
Authentication
Configurable RBAC
Segregation of duties
Core modules
Product/item master
Search
POS module
POS quick checkout
Barcode scanning
Walk-in customers
Customer management
Customer accounts
Accounts receivable
Customer payments
M-Pesa STK Push
Cash sales accounting
Credit sales accounting
Sales returns
Cashier management
Cashier reconciliation
Sales documents
Purchasing module
Purchase order
GRN
Three-way matching
Purchase accounting
Supplier management
Supplier ledger
Supplier returns
Supplier credit/debit notes
Supplier payments
Inventory engine
Inventory locations
Inventory movement ledger
Stock transfers
Stock taking
Inventory valuation
Tax engine
Accounting engine
Chart of accounts
Accounting rule engine
Journal immutability
Financial periods
Business expenses
Petty cash
Central payment engine
Transaction states
Atomic transactions
Idempotency
Concurrency
Balance rule
Accounting reconciliation
Reversals
Audit trail
User activity reporting
Attachments
Reporting
Dashboards
POS UX
General UI/UX
Database design
User foreign keys
Money and quantity
Currency
Document numbering
API design
Backend transaction service
Accounting posting service
Source linking
No direct balance editing
Error handling
Testing
Reconciliation tests
Data integrity
Offline/network resilience
Security
Reporting by user
Approval workflows
Accounting examples
Financial traceability
Development phases
Development workflow
Critical rules
Expected deliverables
Final system requirement'''.splitlines()
partial={1,2,4,5,6,7,10,43,44,47,51,52,53,54,55,57,58,59,61,62,64,65,66,67,68,69,70,71,72,73,74,75,76,78,80,81,82,84,87}
core={46}
phases={0:'Design',1:'Core',2:'Inventory',3:'Purchasing',4:'Sales',5:'Customers',6:'Returns',7:'Expenses/cash',8:'Tax',9:'Integrations',10:'Reporting'}
def phase(i):
 if i in [85,86,88]:return 0
 if 9<=i<=10 or 36<=i<=41:return 2
 if 26<=i<=35:return 3 if i not in [33,34] else 6
 if 11<=i<=14 or i in [20,21,25,63]:return 4
 if 15<=i<=18:return 5
 if i==22:return 6
 if i in [23,24,48,49]:return 7
 if i==42:return 8
 if i in [19,50]:return 9
 if i in [56,59,61,62,77,81]:return 10
 return 1
rows=[]
for i,title in enumerate(titles,1):
 status='DESIGNED / NOT IMPLEMENTED'
 evidence='docs/01-architecture.md; docs/03-api-security.md; domain table baseline where applicable'
 if i in partial:status='PARTIAL — CORE FOUNDATION ONLY';evidence='STATUS.md; apps/api/src; apps/api/test/foundation.test.ts; domain-specific portions remain planned'
 if i in core:status='IMPLEMENTED AND TESTED FOR CORE JOURNALS';evidence='db/001-core.sql; journal immutability integration test'
 if i in [85,86,88]:status='DESIGN BASELINE DELIVERED';evidence='docs/01-architecture.md deliverable map; docs/04-delivery-quality.md'
 if i==77:status='CORE ARITHMETIC ONLY — OPERATIONAL RECONCILIATIONS PENDING';evidence='GET /reports/integrity explicitly returns NOT_IMPLEMENTED for operational reconciliations'
 if i==89:status='NOT COMPLETE';evidence='STATUS.md; complete business lifecycle is not implemented'
 if i in [2,3,5,6,7,51,52,53,54,58,64,71,75,76,80,82]:
  if i==3:status='PARTIAL — AUTH SERVICE ONLY; OPERATIONAL AUTOMATION PENDING'
  evidence+='; docs/05-phase1-controls.md; docs/browser-controls-result.json'
 if i==79:status='PARTIAL — SAME-SESSION COMMAND RETRY KEYS; OFFLINE OPERATIONS DISABLED';evidence='apps/web/src/main.tsx; STATUS.md; sessionStorage hashed command fingerprints; no offline financial posting'
 if i in [4,5,6,54,64,75,76,80]:evidence+='; docs/06-preview-and-organization.md; docs/browser-embedded-result.json; docs/browser-branches-result.json'
 if i in [2,4,6,37,52,54,58,64,65,75,76,78,80]:evidence+='; docs/07-company-and-warehouses.md; docs/browser-organization-result.json'
 if i==37:status='PARTIAL — WAREHOUSE CONFIGURATION ONLY; STOCK ENGINE PENDING'
 if i in [2,4,6,7,10,51,52,53,54,58,64,65,75,76,78,80,82]:evidence+='; docs/09-chart-of-accounts-controls.md; apps/api/test/coa.test.ts; docs/browser-coa-result.json'
 if i==5:evidence+='; docs/08-preview-session-recovery.md; docs/browser-preview-memory-result.json'
 rows.append([i,title,status,str(phase(i))+' — '+phases[phase(i)],evidence])
with Path('docs/requirements.csv').open('w',newline='') as f:
 w=csv.writer(f);w.writerow(['requirement','title','status','primary_phase','evidence_or_design']);w.writerows(rows)
