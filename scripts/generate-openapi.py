import json
from pathlib import Path
ref=lambda n:{'$ref':'#/components/schemas/'+n}
uuid={'type':'string','format':'uuid'}
amount={'type':'string','pattern':r'^(0|[1-9]\d{0,15})(\.\d{1,2})?$','examples':['12500.00']}
def obj(props,required=None):return {'type':'object','properties':props,'required':required or list(props),'additionalProperties':False}
def array(schema):return {'type':'array','items':schema}
schemas={
 'Error':obj({'code':{'type':'string'},'message':{'type':'string'},'requestId':uuid,'details':array(obj({'path':{'type':'string'},'message':{'type':'string'}}))},['code','message','requestId']),
 'Login':obj({'email':{'type':'string','format':'email','maxLength':254},'password':{'type':'string','minLength':1,'maxLength':256,'writeOnly':True}}),
 'JournalLineProposal':obj({'accountId':uuid,'debit':amount,'credit':amount,'description':{'type':'string','maxLength':250,'default':''}},['accountId','debit','credit']),
 'JournalDraft':obj({'branchId':uuid,'date':{'type':'string','format':'date'},'currency':{'type':'string','enum':['KES','USD','EUR'],'description':'Only company functional currency enabled in this release.'},'description':{'type':'string','minLength':5,'maxLength':500},'lines':{'type':'array','items':ref('JournalLineProposal'),'minItems':2,'maxItems':100}}),
 'Reason':obj({'reason':{'type':'string','minLength':5,'maxLength':500}}),
 'ReversalDraft':obj({'date':{'type':'string','format':'date'},'reason':{'type':'string','minLength':5,'maxLength':500}}),
 'EmptyCommand':obj({},[]),
 'SourceResult':obj({'id':uuid,'document_number':{'type':'string'},'status':{'type':'string','enum':['DRAFT','PENDING_APPROVAL','APPROVED','POSTED']},'journalId':{'type':['string','null'],'format':'uuid'}},['id','document_number','status']),
 'Record':{'type':'object','additionalProperties':True,'description':'Read projection; refer to implementation and data dictionary for column-level meanings. Stable typed reporting contracts are a remaining Phase 1 gate.'}
}
spec={'openapi':'3.1.0','info':{'title':'Karibu ERP — implemented foundation API','version':'0.5.0','description':'Only implemented routes are specified. Reviewed stock gain/loss/full-reversal posting is available. Service-credit invoices support inert drafts and immutable valuation submission into independent review; no approval, exposure reservation, AR invoice posting, sales, purchasing, M-Pesa or fiscal posting is released. Runtime authorization, branch scope and database integrity checks are mandatory. Decimal values travel as strings. The full target domain catalog is in 03-api-security.md.'},'servers':[{'url':'/api/v1','description':'Same-origin API'}],'security':[{'sessionCookie':[]}],'paths':{},'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'erp_session'}},'schemas':schemas}}
company={'in':'header','name':'X-Company-ID','required':True,'schema':uuid,'description':'Membership is verified by backend, not trusted as authorization.'}
csrf={'in':'header','name':'X-CSRF-Token','required':True,'schema':{'type':'string'},'description':'Token returned at login, tied to server session.'}
idem={'in':'header','name':'Idempotency-Key','required':True,'schema':{'type':'string','minLength':8,'maxLength':128,'pattern':'^[A-Za-z0-9_.:-]+$'},'description':'Reuse for retries of the exact same command. Changed payload returns 409.'}
query=lambda name,schema:{'in':'query','name':name,'schema':schema}
page=query('page',{'type':'integer','minimum':1,'maximum':10000,'default':1})
q=query('q',{'type':'string','maxLength':100,'default':''})
limit=query('limit',{'type':'integer','minimum':1,'maximum':100,'default':25})
def route(method,path,summary,permission=None,body=None,response=None,params=None,public=False,write_idem=True):
    status='201' if method=='post' else '200'
    op={'operationId':method+'_'+path.strip('/').replace('/','_').replace('{','').replace('}','').replace('-','_'),'summary':summary,'description':('Required permission: `'+permission+'`. ' if permission else '')+'All actors are resolved from the authenticated session; supplied actor fields are rejected.','parameters':[],'responses':{status:{'description':'Command result or read projection','content':{'application/json':{'schema':response or ref('Record')}}}}}
    if public:op['security']=[]
    if permission:op['parameters'].append(company)
    if '{id}' in path:op['parameters'].append({'in':'path','name':'id','required':True,'schema':uuid})
    if method=='post' and not public:
        op['parameters'].append(csrf)
        if write_idem:op['parameters'].append(idem)
    op['parameters']+=params or []
    if body:op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
    for code in ['400','401','403','404','409','415','422','429','500','503']:
        op['responses'][code]={'description':{'400':'Validation','401':'Session missing/expired/revoked','403':'Permission/scope/CSRF/segregation denied','404':'Not found or not visible','409':'State or duplicate/idempotency conflict','415':'JSON content type required','422':'Business/integrity rule rejected','429':'Login throttled','500':'Unexpected error, transaction rolled back','503':'Transient contention, retry same key'}[code],'content':{'application/json':{'schema':ref('Error')}}}
    spec['paths'].setdefault(path,{})[method]=op
route('get','/health','Liveness and release boundary',public=True)
route('post','/auth/login','Sign in; sets HttpOnly session cookie',body='Login',response=obj({'csrfToken':{'type':'string'}}),public=True)
route('get','/auth/me','Authenticated user and active companies',params=[{'in':'header','name':'X-ERP-Resume-Session','required':False,'schema':{'type':'string','enum':['verify-csrf']},'description':'Optional tab-resumption proof; requires the matching X-CSRF-Token. No token is returned or security check bypassed.'},{**csrf,'required':False,'description':'Required when X-ERP-Resume-Session is verify-csrf.'}])
route('post','/auth/logout','Revoke this session',write_idem=False)
route('get','/workspace','Permissions, allowed branches and release status','workspace:view')
route('get','/accounts','Search company chart; maximum 100 accounts','accounting:view',response=array(ref('Record')),params=[q,page,limit])
route('get','/periods','Company financial periods','accounting:view',response=array(ref('Record')))
for action in ['close','reopen']:route('post','/periods/{id}/'+action,'Audited '+action+' of period','periods:'+action,body='Reason')
route('post','/journals/drafts','Create attributable non-control manual journal draft','journals:create','JournalDraft',ref('SourceResult'))
for action,permission in [('submit','journals:create'),('approve','journals:approve'),('post','journals:post')]:route('post','/documents/{id}/'+action,action.title()+' source through controlled state machine',permission,'EmptyCommand',ref('SourceResult'))
route('post','/journals/{id}/reversal-drafts','Create linked opposite journal request; approval/posting still required','journals:reverse','ReversalDraft',ref('SourceResult'))
route('get','/documents','Search and paginate branch-scoped source documents','journals:view',response=obj({'data':array(ref('Record')),'total':{'type':'integer'},'page':{'type':'integer'},'limit':{'type':'integer'}}),params=[q,page,limit])
route('get','/documents/{id}','Source, attributable timeline, journal lines and reversal links','journals:view')
route('get','/journals','Recent immutable journals; newest first','accounting:view',response=array(ref('Record')),params=[limit])
route('get','/reports/trial-balance','All-date company functional-currency account totals','accounting:view',response=array(ref('Record')))
route('get','/reports/integrity','Journal arithmetic check; other reconciliations explicitly not implemented','accounting:view')
route('get','/audit','Company audit events, optional actor filter, 50 per page; product snapshots redacted without products:cost:view, authorized product prices returned as exact strings','audit:view',response=array(ref('Record')),params=[query('userId',uuid),page])

# Implemented increment 0.2 command contracts.
reason={'type':'string','minLength':5,'maxLength':500}
ids={'type':'array','items':uuid,'maxItems':100,'uniqueItems':True}
perms={'type':'array','items':{'type':'string','maxLength':80},'minItems':1,'maxItems':100,'uniqueItems':True}
version={'type':'integer','minimum':1}
schemas.update({
 'MemberProvision':obj({'email':{'type':'string','format':'email'},'name':{'type':'string','minLength':2,'maxLength':100},'roleIds':{**ids,'minItems':1},'branchIds':ids,'reason':reason}),
 'MemberAccess':obj({'active':{'type':'boolean'},'roleIds':{**ids,'minItems':1},'branchIds':ids,'expectedVersion':version,'reason':reason}),
 'RoleWrite':obj({'name':{'type':'string','minLength':3,'maxLength':80},'permissions':perms,'reason':reason}),
 'RoleRevision':obj({'name':{'type':'string','minLength':3,'maxLength':80},'permissions':perms,'expectedVersion':version,'reason':reason}),
 'PolicyDraft':obj({'eventType':{'type':'string','enum':['MANUAL_JOURNAL','JOURNAL_REVERSAL','STOCK_GAIN','STOCK_LOSS','STOCK_REVERSAL','SERVICE_CREDIT_INVOICE']},'threshold':amount,'independentCreator':{'type':'boolean'},'independentPoster':{'type':'boolean'},'steps':{'type':'array','minItems':1,'maxItems':5,'items':obj({'permission':{'type':'string'},'minimumApprovers':{'type':'integer','minimum':1,'maximum':5}})},'reason':reason}),
 'RevisionCommand':obj({**schemas['JournalDraft']['properties'],'expectedRevision':version,'reason':reason}),
 'RevisionReason':obj({'expectedRevision':version,'reason':reason}),
 'ResetRequest':obj({'email':{'type':'string','format':'email','maxLength':254}}),
 'ResetConsume':obj({'token':{'type':'string','pattern':'^[A-Za-z0-9_-]{43}$','writeOnly':True},'password':{'type':'string','minLength':14,'maxLength':128,'writeOnly':True}}),
 'PasswordChange':obj({'currentPassword':{'type':'string','minLength':1,'maxLength':256,'writeOnly':True},'newPassword':{'type':'string','minLength':14,'maxLength':128,'writeOnly':True}})
})
route('get','/admin/users','Search/paginate company members; never password/session secrets','users:view',params=[q,page,limit])
route('post','/admin/users','Provision a new identity and explicitly delegated company access','users:manage','MemberProvision')
route('post','/admin/users/{id}/access','Optimistic audited company membership change; no self-change','users:manage','MemberAccess')
route('get','/admin/roles','Company roles and permission sets; first 100','roles:view',response=array(ref('Record')))
route('post','/admin/roles','Create an explicitly delegated role','roles:manage','RoleWrite')
route('post','/admin/roles/{id}/revise','Optimistic role revision; own role cannot be edited','roles:manage','RoleRevision')
route('get','/admin/permissions','Permission catalog, own delegation allowlist and first 100 company branches including inactive scope retention','roles:view')
route('get','/admin/approval-policies','Policy versions and ordered steps; first 100','approvals:view',response=array(ref('Record')))
route('post','/admin/approval-policies','Create immutable threshold policy draft','approvals:manage','PolicyDraft')
route('post','/admin/approval-policies/{id}/publish','Independent publication; supersede active version at same threshold','approvals:publish','Reason')
route('get','/admin/security-events','Latest company-scoped security events, 50 per page','security:view',params=[page])
route('get','/auth/sessions','Own sessions only; first 100; no hashes or tokens',response=array(ref('Record')))
route('post','/auth/sessions/{id}/revoke','Revoke own session UUID, or all own sessions','',body='EmptyCommand',write_idem=False)
for par in spec['paths']['/auth/sessions/{id}/revoke']['post']['parameters']:
 if par['name']=='id':par['schema']={'oneOf':[uuid,{'type':'string','const':'all'}]}
route('post','/auth/password-reset/request','Generic rate-limited acknowledgement; encrypted outbox; never returns token',body='ResetRequest',public=True)
route('post','/auth/password-reset/consume','Single-use reset; atomic password update and revoke all sessions',body='ResetConsume',public=True)
route('post','/auth/password/change','Verify current password, replace it, revoke all sessions',body='PasswordChange',write_idem=False)
route('post','/documents/{id}/revise','Archive previous revision and invalidate effective approvals','journals:edit','RevisionCommand')
route('post','/documents/{id}/reject','Append current-step rejection and retain decisions','journals:reject','RevisionReason')
route('post','/documents/{id}/cancel','Cancel unposted source, retaining all history','journals:cancel','RevisionReason')
# 0.3: secure embedded session option and audited branch configuration.
spec['components']['securitySchemes']['previewCookie']={'type':'apiKey','in':'cookie','name':'__Host-erp_preview','description':'Only when SESSION_COOKIE_MODE=partitioned. Secure/HttpOnly/SameSite=None/Partitioned; not an authentication bypass.'}
spec['security']=[{'sessionCookie':[]},{'previewCookie':[]}]
schemas['BranchCreate']=obj({'code':{'type':'string','minLength':2,'maxLength':24,'pattern':'^[A-Z0-9][A-Z0-9_-]*$'},'name':{'type':'string','minLength':2,'maxLength':120},'reason':reason})
schemas['BranchRevision']=obj({'name':{'type':'string','minLength':2,'maxLength':120},'active':{'type':'boolean'},'expectedVersion':version,'reason':reason})
route('get','/admin/branches','Paginated company branch configuration and attribution','organization:view',params=[q,page,limit])
route('post','/admin/branches','Create a branch; no automatic access or financial effects','organization:manage','BranchCreate')
route('post','/admin/branches/{id}/revise','Optimistic name/active revision; immutable identity; dependency-guarded deactivation','organization:manage','BranchRevision')
# 0.4: company display profile and immutable warehouse hierarchy.
schemas['CompanyNameRevision']=obj({'name':{'type':'string','minLength':2,'maxLength':120},'expectedVersion':version,'reason':reason})
schemas['WarehouseCreate']=obj({'branchId':uuid,'code':{'type':'string','minLength':2,'maxLength':24,'pattern':'^[A-Z0-9][A-Z0-9_-]*$'},'name':{'type':'string','minLength':2,'maxLength':120},'locationType':{'type':'string','enum':['SELLABLE','TRANSIT','QUARANTINE','DAMAGED','RETURNS']},'reason':reason})
schemas['WarehouseRevision']=schemas['BranchRevision'].copy()
route('get','/admin/company','Current company profile and original attribution; legal/accounting identity is read-only','organization:view')
route('post','/admin/company/revise','Optimistic display-name revision, separate permission and atomic audit','organization:profile:manage','CompanyNameRevision')
route('get','/admin/warehouses','Paginated current-company warehouse configuration','warehouses:view',params=[q,page,limit,query('branchId',uuid)])
route('get','/admin/warehouses/branch-options','Paginated active same-company parent branch options','warehouses:view',params=[q,page,limit])
route('post','/admin/warehouses','Create a warehouse; no stock, balances or scopes created','warehouses:manage','WarehouseCreate')
route('post','/admin/warehouses/{id}/revise','Versioned name/status revision; immutable identity/parent/type; conservative dependency closure guard','warehouses:manage','WarehouseRevision')
# 0.4.1: explicit development-only memory session transport; production cookie-only.
route('get','/auth/config','Public development session capability; no-store',response=obj({'previewMemorySession':{'type':'boolean'}}),public=True)
spec['components']['securitySchemes']['previewMemory']={'type':'apiKey','in':'header','name':'X-ERP-Session','description':'Development only, ENABLE_PREVIEW_MEMORY_SESSION=true; forbidden in production. Same server session and CSRF checks. Invalid supplied header never falls back to a cookie.'}
spec['security'].append({'previewMemory':[]})
login=spec['paths']['/auth/login']['post']
login['summary']='Password sign-in; HttpOnly cookie by default, optional development memory transport'
login['parameters'].append({'in':'header','name':'X-ERP-Session-Transport','required':False,'schema':{'type':'string','enum':['memory']},'description':'Explicit development opt-in. Ignored when disabled; production never issues a memory token.'})
login['responses']['201']['content']['application/json']['schema']=obj({'csrfToken':{'type':'string'},'previewSessionToken':{'type':'string','readOnly':True,'description':'Returned only for successful explicit development negotiation. Memory only, never persist or log.'}},['csrfToken'])
login['responses']['201']['headers']={'Cache-Control':{'schema':{'type':'string','const':'no-store'}}}
# 0.5: non-financial, independently reviewed chart configuration.
account_type={'type':'string','enum':['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE']}
schemas['AccountCreateProposal']=obj({'kind':{'const':'CREATE','type':'string'},'code':{'type':'string','minLength':2,'maxLength':24,'pattern':'^[A-Z0-9][A-Z0-9_-]*$'},'name':{'type':'string','minLength':2,'maxLength':120},'accountType':account_type,'parentId':{'type':['string','null'],'format':'uuid'},'postable':{'type':'boolean'},'reason':reason})
schemas['AccountRenameProposal']=obj({'kind':{'const':'RENAME','type':'string'},'accountId':uuid,'expectedVersion':version,'name':{'type':'string','minLength':2,'maxLength':120},'reason':reason})
schemas['AccountProposal']={'oneOf':[ref('AccountCreateProposal'),ref('AccountRenameProposal')],'discriminator':{'propertyName':'kind'}}
schemas['AccountDecision']=obj({'decision':{'type':'string','enum':['APPROVE','REJECT']},'reason':reason})
route('get','/admin/accounts','Paginated complete company account catalog and attribution','accounts:configuration:view',params=[q,page,limit])
route('get','/admin/accounts/parents','Paginated active non-posting same-classification parent candidates','accounts:configuration:view',params=[q,page,limit,{**query('accountType',account_type),'required':True}])
route('get','/admin/account-changes','Paginated immutable configuration requests with reviewer attribution','accounts:configuration:view',params=[q,page,limit,query('state',{'type':'string','enum':['PENDING','APPLIED','REJECTED']})])
route('post','/admin/account-changes','Propose CREATE or RENAME; no live account/financial effect','accounts:propose','AccountProposal')
route('post','/admin/account-changes/{id}/decide','Independent terminal review; atomically apply account and audit or reject','accounts:approve','AccountDecision')
# Controlled branch/type/calendar-year numbering; counters are never input fields.
number_identity={'branchId':uuid,'documentType':{'type':'string','maxLength':64,'description':'Choose a released document_type from the types endpoint.'},'year':{'type':'integer','minimum':1,'maximum':9999}}
schemas['NumberingProposal']=obj({**number_identity,'prefix':{'type':'string','minLength':2,'maxLength':16,'pattern':'^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'},'padding':{'type':'integer','minimum':4,'maximum':12},'expectedVersion':{'type':'integer','minimum':0,'description':'Zero for inherited registry format; current override version otherwise.'},'reason':reason})
schemas['NumberingDecision']=obj({'decision':{'type':'string','enum':['APPROVE','REJECT']},'reason':reason})
schemas['NumberingEffective']=obj({'prefix':{'type':'string'},'padding':{'type':'integer'},'version':{'type':'integer'},'policy_id':{'type':['string','null'],'format':'uuid'},'inherited':{'type':'boolean'},'locked':{'type':'boolean'},'branch':obj({'id':uuid,'code':{'type':'string'},'name':{'type':'string'},'active':{'type':'boolean'}})})
route('get','/admin/numbering-policies','Paginated published format overrides, origin and initialization lock','numbering:view',params=[q,page,limit])
route('get','/admin/numbering-policies/effective','Resolve override/default and whether this key is initialized','numbering:view',response=ref('NumberingEffective'),params=[{'in':'query','name':k,'required':True,'schema':v} for k,v in number_identity.items()])
route('get','/admin/numbering-policies/types','Released document-type registry; no operational type is fabricated','numbering:view',response=array(obj({'document_type':{'type':'string'},'prefix':{'type':'string'},'padding':{'type':'integer'}})))
route('get','/admin/numbering-policies/branches','Paginated active company branches for configuration','numbering:view',params=[q,page,limit])
route('get','/admin/numbering-policy-changes','Paginated immutable proposal/review history with current version','numbering:view',params=[q,page,limit,query('state',{'type':'string','enum':['PENDING','APPLIED','REJECTED']})])
route('post','/admin/numbering-policy-changes','Propose an unused key format; no counter or financial effects','numbering:propose','NumberingProposal')
route('post','/admin/numbering-policy-changes/{id}/decide','Independent terminal review with version/prefix/initialization recheck and exact before/after audit','numbering:approve','NumberingDecision')
# Reviewed inventory-event posting configuration. Not an operational posting API.
nullable_id={'type':['string','null'],'format':'uuid'}
rule_date={'type':'string','format':'date','description':'Gregorian business date, years 0001–9999; effective ends inclusive.'}
rule_reason={'type':'string','minLength':5,'maxLength':500}
schemas['PostingRuleCreate']=obj({'kind':{'const':'CREATE'},'eventType':{'type':'string','pattern':'^[A-Z][A-Z0-9_]{1,63}$'},'contractVersion':{'type':'integer','minimum':1,'maximum':2147483647},'validFrom':rule_date,'validTo':{'type':['string','null'],'format':'date'},'priority':{'type':'integer','minimum':-2147483648,'maximum':2147483647},'branchId':nullable_id,'warehouseId':nullable_id,'legs':{'type':'array','minItems':2,'maxItems':100,'items':obj({'legCode':{'type':'string','pattern':'^[A-Z][A-Z0-9_]{1,47}$'},'accountId':uuid})},'reason':rule_reason},['kind','eventType','contractVersion','validFrom','validTo','priority','legs','reason'])
schemas['PostingRuleRetire']=obj({'kind':{'const':'RETIRE'},'ruleId':uuid,'expectedVersion':{'type':'integer','minimum':0,'maximum':2147483646},'effectiveThrough':rule_date,'reason':rule_reason})
schemas['PostingRuleProposal']={'oneOf':[ref('PostingRuleCreate'),ref('PostingRuleRetire')]}
schemas['PostingRuleDecision']=obj({'decision':{'enum':['APPROVE','REJECT']},'reason':rule_reason})
required_query=lambda name,schema:{'in':'query','name':name,'required':True,'schema':schema}
route('get','/admin/posting-rules/contracts','Sealed migration-owned symbolic leg contracts and eligibility; configuration-only workflows','rules:view',response=array(ref('Record')))
route('get','/admin/posting-rules/accounts','Search active postable same-company eligible functional-currency accounts; no ledger balance grant','rules:view',params=[q,page,limit,required_query('eventType',{'type':'string'}),required_query('contractVersion',{'type':'integer','minimum':1}),required_query('legCode',{'type':'string','maxLength':48})])
route('get','/admin/posting-rules/scope-options','Search active company branches or branch warehouses; branchId required for WAREHOUSE','rules:view',params=[q,page,limit,required_query('kind',{'enum':['BRANCH','WAREHOUSE']}),query('branchId',uuid)])
route('get','/admin/posting-rules/effective','Informational selection using the central resolver and reviewed retirement intervals; returns match false for missing/ambiguous rules','rules:view',params=[required_query('eventType',{'type':'string'}),required_query('date',rule_date),required_query('branchId',uuid),query('warehouseId',uuid)])
route('get','/admin/posting-rules','Paginated immutable published mappings, account labels and retirement history','rules:view',params=[q,page,limit])
route('get','/admin/posting-rule-changes','Paginated proposal/decision history and complete proposed bindings','rules:view',params=[q,page,limit,query('state',{'enum':['PENDING','APPLIED','REJECTED']})])
route('post','/admin/posting-rule-changes','Create an inert CREATE or prospective RETIRE proposal; no stock/tax/journal effect','rules:propose','PostingRuleProposal')
route('post','/admin/posting-rule-changes/{id}/decide','Independent final review; revalidates accounts/scope/overlap or retirement version and persists exact atomic audit','rules:approve','PostingRuleDecision')

# Controlled tax configuration; previews do not post operational transactions.
tax_basis={'type':'string','minLength':5,'maxLength':1000}
tax_code={'type':'string','pattern':'^[A-Z][A-Z0-9_]{1,31}$'}
tax_factor={'type':'string','pattern':'^(0|[1-9][0-9]{0,2})(\\.[0-9]{1,10})?$','description':'Exact fractional factor, bounded 0 through 100; 1 means 100 percent.'}
tax_fraction={'type':'string','pattern':'^(0(\\.[0-9]{1,10})?|1(\\.0{1,10})?)$'}
tax_common={'basis':tax_basis,'reason':rule_reason}
schemas['TaxDefinitionProposal']=obj({**tax_common,'kind':{'const':'TAX'},'code':tax_code,'name':{'type':'string','minLength':2,'maxLength':120},'taxType':{'enum':['VAT','EXCISE','LEVY','OTHER']}})
schemas['TaxCategoryProposal']=obj({**tax_common,'kind':{'const':'CATEGORY'},'code':tax_code,'name':{'type':'string','minLength':2,'maxLength':120},'classification':{'enum':['TAXABLE','ZERO_RATED','EXEMPT','NON_TAXABLE']}})
schemas['TaxRateProposal']=obj({**tax_common,'kind':{'const':'RATE'},'taxId':uuid,'categoryId':uuid,'validFrom':rule_date,'validTo':rule_date,'rate':tax_factor,'inclusive':{'type':'boolean'},'recoverableFraction':tax_fraction,'inputAccountId':uuid,'outputAccountId':uuid})
schemas['TaxProposal']={'oneOf':[ref('TaxDefinitionProposal'),ref('TaxCategoryProposal'),ref('TaxRateProposal')]}
schemas['TaxPreview']=obj({'categoryId':uuid,'taxIds':{'type':'array','maxItems':10,'uniqueItems':True,'items':uuid},'date':rule_date,'quantity':{'type':'string','maxLength':30},'unitPrice':{'type':'string','maxLength':30},'discount':{'type':'string','maxLength':30}})
route('get','/admin/tax-configuration','Search reviewed immutable tax definitions, categories or finite schedules','taxes:view',params=[q,page,limit,required_query('kind',{'enum':['TAX','CATEGORY','RATE']})])
route('get','/admin/tax-accounts','Search eligible functional-currency ASSET/TAX input or LIABILITY/TAX output accounts, without balances','taxes:view',params=[q,page,limit,required_query('direction',{'enum':['INPUT','OUTPUT']})])
route('get','/admin/tax-changes','Search proposal and immutable independent-decision history','taxes:view',params=[q,page,limit,query('state',{'enum':['PENDING','APPLIED','REJECTED']})])
route('post','/admin/tax-changes','Propose inert tax configuration; no hard-coded statutory activation or financial effects','taxes:propose','TaxProposal')
route('post','/admin/tax-changes/{id}/decide','Independent atomic publication/rejection with exact audit and eligibility/overlap revalidation','taxes:approve','PostingRuleDecision')
route('post','/admin/tax-preview','Informational exact same-base calculation using reviewed IDs/date; no caller factors or operational authority','taxes:view','TaxPreview',write_idem=False)

# Governed product reference masters; no SKU, stock quantity or pricing API implied.
ref_name={'type':'string','minLength':2,'maxLength':120}
ref_code={'type':'string','pattern':'^[A-Z][A-Z0-9_-]{0,31}$'}
schemas['ProductUnitCreate']=obj({'kind':{'const':'UNIT'},'code':ref_code,'name':ref_name,'quantityScale':{'type':'integer','minimum':0,'maximum':6},'reason':rule_reason})
schemas['ProductCategoryCreate']=obj({'kind':{'const':'CATEGORY'},'code':ref_code,'name':ref_name,'parentId':nullable_id,'reason':rule_reason},['kind','code','name','reason'])
schemas['ProductBrandCreate']=obj({'kind':{'const':'BRAND'},'name':ref_name,'reason':rule_reason})
schemas['ProductReferenceCreate']={'oneOf':[ref('ProductUnitCreate'),ref('ProductCategoryCreate'),ref('ProductBrandCreate')]}
route('get','/admin/product-references','Search governed immutable units, categories or brands; no finance access grant','products:view',params=[q,page,limit,required_query('kind',{'enum':['UNIT','CATEGORY','BRAND']})])
route('post','/admin/product-references','Create attributed immutable reference metadata with exact atomic audit and no financial/stock/tax effect','products:manage','ProductReferenceCreate')

# Independently reviewed initial SKU registration. No inventory posting or editable balances.
product_identity={'type':'string','pattern':'^[A-Z0-9][A-Z0-9._/-]{0,63}$'}
product_price={'type':'string','pattern':r'^(0|[1-9]\d{0,13})(\.\d{1,6})?$','description':'Exact nonnegative decimal: at most 14 integer and 6 fractional digits; never convert through binary floating point.'}
product_barcode={'type':'string','minLength':1,'maxLength':128,'pattern':'^[!-~]+$','description':'Case-sensitive printable no-space ASCII; leading zeros retained.'}
product_date={'type':'string','format':'date','pattern':r'^(?!0000)\d{4}-\d{2}-\d{2}$','description':'Finite Gregorian calendar date, years 0001–9999. Full interval must have compatible reviewed schedules.'}
schemas['ProductProposal']=obj({'sku':product_identity,'productCode':product_identity,'name':{'type':'string','minLength':2,'maxLength':160},'description':{'type':['string','null'],'maxLength':1000,'default':None},'itemType':{'enum':['STOCK','SERVICE','NON_STOCK']},'categoryId':uuid,'brandId':{**nullable_id,'default':None},'uomId':uuid,'purchasePrice':product_price,'sellingPrice':product_price,'priceMode':{'enum':['INCLUSIVE','EXCLUSIVE']},'taxCategoryId':uuid,'validFrom':product_date,'validTo':product_date,'taxIds':{'type':'array','items':uuid,'maxItems':10,'uniqueItems':True},'barcodes':{'type':'array','items':product_barcode,'maxItems':20,'uniqueItems':True},'reason':rule_reason},['sku','productCode','name','itemType','categoryId','uomId','purchasePrice','sellingPrice','priceMode','taxCategoryId','validFrom','validTo','taxIds','barcodes','reason'])
schemas['ProductTaxPreview']=obj({'date':product_date,'quantity':product_price,'discount':{'type':'string','maxLength':30,'default':'0'}},['date','quantity'])
route('get','/admin/products','Search independently registered products; purchase_price null without products:cost:view','products:view',params=[q,page,limit])
route('get','/admin/products/lookup','Exact active governed base-unit barcode lookup; no stock availability implied','products:view',params=[required_query('barcode',product_barcode)])
route('get','/admin/products/{id}','Governed product identity, exact initial prices, barcodes and dated profile; purchase cost permission enforced','products:view')
route('get','/admin/product-changes','Search immutable proposal/review history; purchase costs permission-masked','products:view',params=[q,page,limit,query('state',{'enum':['PENDING','APPLIED','REJECTED']})])
route('post','/admin/product-changes','Propose inert initial SKU, prices, base-unit barcodes and tax assignments; no operational effects','products:propose','ProductProposal')
route('post','/admin/product-changes/{id}/decide','Independent atomic registration or rejection; approval also requires current products:cost:view','products:approve','PostingRuleDecision')
route('post','/admin/products/{id}/tax-preview','Informational dated tax preview using stored selling price and base-unit precision; caller price/rate/account/actor rejected','products:view','ProductTaxPreview',write_idem=False)

# Operational endpoints live outside the v1 business route prefix.
health_live=obj({'status':{'const':'alive'},'service':{'const':'erp-api'}})
health_ready=obj({'ready':{'type':'boolean'},'status':{'enum':['ready','not_ready']},'checks':{'type':'object','additionalProperties':{'enum':['ok','failed','not_required']}},'productionReady':{'const':False}})
schemas['HealthLiveness']=health_live;schemas['HealthReadiness']=health_ready
for suffix,title,schema in [('/api/health','Dependency readiness alias','HealthReadiness'),('/api/health/live','Process liveness, independent of database','HealthLiveness'),('/api/health/ready','Database, migration, worker and configured storage readiness','HealthReadiness')]:
    responses={'200':{'description':title,'content':{'application/json':{'schema':ref(schema)}}}}
    if schema=='HealthReadiness':responses['503']={'description':'A required dependency is unavailable; no credentials, SQL or stack trace returned.','content':{'application/json':{'schema':ref(schema)}}}
    spec['paths'][suffix]={'servers':[{'url':'/'}],'get':{'operationId':'get_'+suffix.strip('/').replace('/','_'),'summary':title,'security':[],'responses':responses}}
spec['paths']['/health']['get']['summary']='Legacy alias of dependency readiness; no static success response'
spec['paths']['/health']['get']['responses']=spec['paths']['/api/health/ready']['get']['responses']
# Released018 source-led stock workflow; no balance CRUD.
stock_quantity={'type':'string','pattern':r'^(0|[1-9]\d{0,13})(\.\d{1,6})?$','description':'Strictly positive; governed base-unit precision enforced server-side.'}
stock_common={'warehouseId':uuid,'productId':uuid,'quantity':stock_quantity,'date':{'type':'string','format':'date'},'reason':reason}
schemas['StockGainDraft']=obj({**stock_common,'kind':{'const':'STOCK_GAIN'},'value':{**amount,'description':'Strictly positive proposed total functional value, subject to independent review.'}})
schemas['StockLossDraft']=obj({**stock_common,'kind':{'const':'STOCK_LOSS'}})
schemas['StockDraft']={'oneOf':[ref('StockGainDraft'),ref('StockLossDraft')]}
schemas['StockTransition']=obj({'expectedRevision':version,'reason':reason})
for path,title in [('adjustments','Scoped stock sources'),('balances','Read-only movement-derived stock pools'),('products','Governed nontracked STOCK picklist'),('warehouses','Assigned active sellable warehouses')]:route('get','/inventory/'+path,title,'inventory:view + inventory:cost:view',params=[q,page,limit])
route('get','/inventory/adjustments/{id}','Stock source, frozen valuation, retained approvals, journal lines, movements and attributable timeline','inventory:view + inventory:cost:view')
route('get','/inventory/reconciliation','One-snapshot assigned-branch movement/projection/inventory-control GL discrepancy report; not complete ERP reconciliation','inventory:view + inventory:cost:view')
route('post','/inventory/adjustments','Propose inert single-product gain/loss; no stock effect until posting','inventory:create + inventory:cost:view','StockDraft')
for action,permission in [('submit','submit'),('approve','approve'),('reject','approve'),('post','post'),('refresh','submit'),('cancel','cancel')]:route('post','/inventory/adjustments/{id}/'+action,action.title()+' reviewed stock source; current scope, segregation, policy and state checks apply','inventory:'+permission+' + inventory:cost:view','StockTransition')
route('post','/inventory/adjustments/{id}/reversal-drafts','Propose linked full original-cost reversal; no chains, partial reversals or current-average substitution','inventory:reverse + inventory:cost:view','ReversalDraft')
spec['paths']['/audit']['get']['description']+=' Inventory source snapshots are redacted without inventory:cost:view. Stock source links include document_type and are not manual-journal editor targets.'
# Initial independently reviewed customer masters; no AR posting.
schemas['CustomerProposal']=obj({'number':{'type':'string','pattern':'^[A-Z][A-Z0-9_-]{0,31}$'},'name':{'type':'string','minLength':2,'maxLength':160},'customerType':{'enum':['REGISTERED','WALK_IN']},'creditLimit':amount,'paymentTermsDays':{'type':'integer','minimum':0,'maximum':3650},'controlAccountId':{'type':['string','null'],'format':'uuid'},'taxCategoryId':{'type':['string','null'],'format':'uuid','default':None},'phone':{'type':['string','null'],'minLength':3,'maxLength':40},'email':{'type':['string','null'],'format':'email','maxLength':254},'address':{'type':['string','null'],'minLength':2,'maxLength':1000},'taxPin':{'type':['string','null'],'pattern':'^[A-Z][0-9]{9}[A-Z]$'},'reason':reason},['number','name','customerType','creditLimit','paymentTermsDays','controlAccountId','reason'])
schemas['CustomerDecision']=obj({'decision':{'enum':['APPROVE','REJECT']},'reason':reason})
for suffix,title in [('', 'Approved customer profiles and credit-policy metadata'),('/changes','Immutable initial customer proposals and decisions'),('/accounts','Eligible same-company AR leaf picker, not financial balances'),('/tax-categories','Governed classification picker, not an invoice tax override')]:route('get','/customers'+suffix,title,'customers:view',params=[q,page,limit])
route('get','/customers/{id}','Customer profile, exact credit policy, reviewed account binding and attribution','customers:view')
route('post','/customers/changes','Propose inert initial customer registration; REGISTERED requires AR binding; WALK_IN requires zero credit/terms and no PII/binding','customers:propose','CustomerProposal')
route('post','/customers/changes/{id}/decide','Independent immutable initial customer publication or rejection; no AR entries or opening balance','customers:approve','CustomerDecision')
spec['paths']['/audit']['get']['description']+=' Customer snapshots are redacted without customers:view.'
# Versioned customer profile/policy changes; no balance or financial authority.
schemas['CustomerAmendment']=obj({**{k:schemas['CustomerProposal']['properties'][k] for k in ['name','phone','email','address','creditLimit','paymentTermsDays','reason']},'expectedVersion':{'type':'integer','minimum':1,'maximum':2147483646},'creditHold':{'type':'boolean'}})
route('get','/customers/{id}/amendments','Paginated immutable amendment history and exact retained before/after policy','customers:view',params=[page,limit])
route('post','/customers/{id}/amendments','Inert versioned profile proposal; customers:credit:propose additionally required for limit/terms/hold changes; used-customer credit changes fail closed','customers:amend:propose','CustomerAmendment')
route('post','/customers/amendments/{id}/decide','Independent atomic versioned approval/rejection; customers:credit:approve additionally required for credit-policy requests; no AR entry','customers:amend:approve','CustomerDecision')
# First AR-source increment: inert service-credit invoice drafts only. Submit,
# approval, posting, reversal and reconciliation remain unreleased.
schemas['ServiceCreditInvoiceDraft']=obj({'warehouseId':uuid,'customerId':uuid,'productId':uuid,'quantity':stock_quantity,'date':product_date,'reason':rule_reason})
schemas['InvoiceAmountPreview']=obj({'currency':{'type':'string','pattern':'^[A-Z]{3}$'},'net':amount,'tax':amount,'gross':amount,'dueDate':{'type':'string','format':'date'}})
schemas['ServiceCreditInvoiceDraftResult']=obj({'id':uuid,'documentNumber':{'type':'string'},'status':{'const':'DRAFT'},'revision':{'type':'integer'},'amountPreview':{**ref('InvoiceAmountPreview'),'description':'Informational current valuation only; not persisted, not a quote commitment and not posting authority.'}})
schemas['ServiceCreditInvoiceSubmit']=obj({'expectedRevision':{'type':'integer','minimum':1},'reason':reason})
schemas['ServiceCreditInvoiceSubmitResult']=obj({'id':uuid,'documentNumber':{'type':'string'},'status':{'const':'PENDING_APPROVAL'},'revision':{'type':'integer'},'valuation':ref('InvoiceAmountPreview')})
route('get','/customer-invoices','Paginated branch-scoped inert credit invoice drafts; no AR balance or posting implied','customer-invoices:view',response=obj({'data':array(ref('Record')),'total':{'type':'integer'},'page':{'type':'integer'},'limit':{'type':'integer'}}),params=[q,page,limit])
route('get','/customer-invoices/{id}','Branch-scoped source details; credit-policy fields require customer-invoices:credit:view. A submitted valuation does not imply headroom authorization, ledger posting or fiscal issuance','customer-invoices:view')
route('post','/customer-invoices/{id}/submit','Re-resolve governed customer/product/tax inputs and freeze a typed valuation with independent approval-policy snapshot; no exposure reservation or ledger effects','customer-invoices:submit','ServiceCreditInvoiceSubmit',ref('ServiceCreditInvoiceSubmitResult'))
route('post','/customer-invoices','Create an inert functional-currency credit invoice draft for an active registered customer and governed SERVICE product; no AR, tax, stock or journal effects','customer-invoices:create','ServiceCreditInvoiceDraft',ref('ServiceCreditInvoiceDraftResult'))
Path('docs/openapi.json').write_text(json.dumps(spec,indent=2)+'\n')
print('Generated OpenAPI:',len(spec['paths']),'paths')
