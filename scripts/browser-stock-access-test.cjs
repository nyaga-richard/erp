const {chromium,expect,request}=require('@playwright/test');
const fs=require('fs'),assert=require('node:assert/strict'),{randomUUID}=require('crypto'),{execFileSync}=require('child_process');
(async()=>{
 const base=process.env.WEB_URL||'http://127.0.0.1:5173',company='10000000-0000-4000-8000-000000000001',stamp=Date.now(),email=`stock.observer.${stamp}@example.test`,password=randomUUID()+'Aa9!';
 const credentials=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8')),api=await request.newContext({extraHTTPHeaders:{Origin:base,'X-ERP-Session-Transport':'memory'}});let browser,headers,member,role;
 async function post(path,data,authenticated=true){const response=await api.post(base+'/api/v1'+path,{data,headers:authenticated?{...headers,'Idempotency-Key':randomUUID()}:undefined});assert.ok(response.ok(),path+' returned '+response.status());return response.json();}
 try{
  const login=await post('/auth/login',{email:'admin@demo.local',password:credentials.password},false);headers={'X-Company-ID':company,'X-CSRF-Token':login.csrfToken,...(login.previewSessionToken?{'X-ERP-Session':login.previewSessionToken}:{})};
  role=await post('/admin/roles',{name:'DEMO stock observer '+stamp,permissions:['workspace:view','inventory:view','audit:view'],reason:'DEMO isolated least-privilege navigation regression'});
  member=await post('/admin/users',{email,name:'DEMO stock observer '+stamp,roleIds:[role.id],branchIds:['20000000-0000-4000-8000-000000000001'],reason:'DEMO isolated least-privilege navigation regression'});
  await post('/auth/password-reset/request',{email},false);execFileSync(process.execPath,['scripts/auth-mail-worker.cjs','--once'],{stdio:'pipe'});
  let mail;await expect.poll(()=>{mail=fs.readdirSync('.runtime/mail').map(f=>JSON.parse(fs.readFileSync('.runtime/mail/'+f,'utf8'))).find(m=>m.to===email);return !!mail;},{timeout:10000}).toBe(true);
  await post('/auth/password-reset/consume',{token:mail.text.match(/#reset=([A-Za-z0-9_-]+)/)[1],password},false);
  browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);const signedIn=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login'));await page.getByRole('button',{name:'Sign in to workspace'}).click();const identity=await (await signedIn).json();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Control center',exact:true})).toBeVisible();
  await expect(page.getByText('Valued stock workflows require explicit inventory:cost:view permission. No costs or balances are displayed.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'New stock adjustment'})).toHaveCount(0);await expect(page.getByRole('button',{name:'General ledger',exact:true})).toHaveCount(0);
  const readHeaders={'X-Company-ID':company,'X-CSRF-Token':identity.csrfToken,...(identity.previewSessionToken?{'X-ERP-Session':identity.previewSessionToken}:{})};
  const fixture=JSON.parse(fs.readFileSync('docs/browser-stock-result.json'));
  for(const path of ['/inventory/adjustments','/inventory/adjustments/'+fixture.reversal,'/inventory/balances','/inventory/reconciliation','/accounts']){const r=await page.context().request.get(base+'/api/v1'+path,{headers:readHeaders});assert.equal(r.status(),403,path);}
  const audit=await page.context().request.get(base+'/api/v1/audit',{headers:readHeaders});assert.equal(audit.status(),200);const events=(await audit.json()).filter(r=>r.entity_type==='INVENTORY_SOURCE');assert.ok(events.length);assert.ok(events.every(r=>r.new_values.redacted===true));
  await post('/admin/roles/'+role.id+'/revise',{name:'DEMO stock observer '+stamp,permissions:['workspace:view','inventory:view','inventory:cost:view','audit:view'],expectedVersion:1,reason:'DEMO explicit cost-read grant; no finance or stock mutation authority'});
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'Stock adjustments',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'New stock adjustment'})).toHaveCount(0);
  const detail=await page.context().request.get(base+'/api/v1/inventory/adjustments/'+fixture.reversal,{headers:readHeaders});assert.equal(detail.status(),200);const source=await detail.json();assert.equal(source.journalLines.length,2);assert.ok(source.journalLines.every(l=>typeof l.debit==='string'&&typeof l.credit==='string'));
  await page.locator('[data-stock-source="'+fixture.reversal+'"]').getByRole('button',{name:'View stock source'}).click();await expect(page.getByRole('dialog')).toContainText('Posted account');await expect(page.getByRole('dialog')).toContainText('Retained approval policy');await expect(page.getByRole('button',{name:'Propose full reversal',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Close stock dialog'}).click();
  await page.getByRole('button',{name:'Reconcile stock',exact:true}).click();await expect(page.getByTestId('stock-reconciliation')).toContainText('PASS');
  for(const path of ['/accounts','/journals','/reports/trial-balance']){const r=await page.context().request.get(base+'/api/v1'+path,{headers:readHeaders});assert.equal(r.status(),403,path);}
  for(const path of ['/inventory/adjustments','/inventory/adjustments/'+fixture.gain+'/approve','/inventory/adjustments/'+fixture.gain+'/post','/inventory/adjustments/'+fixture.gain+'/reversal-drafts']){const r=await page.context().request.post(base+'/api/v1'+path,{headers:{...readHeaders,Origin:base,'Idempotency-Key':randomUUID()},data:{}});assert.equal(r.status(),403,path);}
  await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.deepEqual(errors,[]);
  const result={passed:true,date:new Date().toISOString(),browser:'Chromium',workflow:['Real reset-mail identity and isolated inventory reader','No costs, balances or source detail without cost grant','Inventory audit snapshots redacted without cost visibility','Explicit cost grant enables read-only source/journal/approval/reconciliation UI','No implicit finance or stock mutation authority; backend403 verified'],consoleErrors:errors};fs.writeFileSync('docs/browser-stock-access-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{
  if(browser)await browser.close();
  try{if(member)await post('/admin/users/'+member.id+'/access',{active:false,roleIds:[role.id],branchIds:['20000000-0000-4000-8000-000000000001'],expectedVersion:1,reason:'DEMO isolated browser fixture retired after test'});if(headers)await api.post(base+'/api/v1/auth/logout',{headers});}finally{await api.dispose();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
