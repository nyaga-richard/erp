const {chromium,expect,request}=require('@playwright/test');
const fs=require('fs'),assert=require('node:assert/strict'),{randomUUID}=require('crypto'),{execFileSync}=require('child_process');
(async()=>{
 const base=process.env.WEB_URL||'http://127.0.0.1:5173',company='10000000-0000-4000-8000-000000000001',stamp=Date.now(),email=`customer.observer.${stamp}@example.test`,password=randomUUID()+'Aa9!';
 const credentials=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8')),api=await request.newContext({extraHTTPHeaders:{Origin:base,'X-ERP-Session-Transport':'memory'}});let browser,headers,member,role;
 async function post(path,data,authenticated=true){const response=await api.post(base+'/api/v1'+path,{data,headers:authenticated?{...headers,'Idempotency-Key':randomUUID()}:undefined});assert.ok(response.ok(),path+' returned '+response.status());return response.json();}
 try{
  const login=await post('/auth/login',{email:'admin@demo.local',password:credentials.password},false);headers={'X-Company-ID':company,'X-CSRF-Token':login.csrfToken,...(login.previewSessionToken?{'X-ERP-Session':login.previewSessionToken}:{})};
  role=await post('/admin/roles',{name:'DEMO customer observer '+stamp,permissions:['workspace:view','customers:view','audit:view'],reason:'DEMO isolated least-privilege navigation regression'});
  member=await post('/admin/users',{email,name:'DEMO customer observer '+stamp,roleIds:[role.id],branchIds:[],reason:'DEMO isolated least-privilege navigation regression'});
  await post('/auth/password-reset/request',{email},false);execFileSync(process.execPath,['scripts/auth-mail-worker.cjs','--once'],{stdio:'pipe'});
  let mail;await expect.poll(()=>{mail=fs.readdirSync('.runtime/mail').map(f=>JSON.parse(fs.readFileSync('.runtime/mail/'+f,'utf8'))).find(m=>m.to===email);return !!mail;},{timeout:10000}).toBe(true);
  await post('/auth/password-reset/consume',{token:mail.text.match(/#reset=([A-Za-z0-9_-]+)/)[1],password},false);
  browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);const signedIn=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login'));await page.getByRole('button',{name:'Sign in to workspace'}).click();const identity=await (await signedIn).json();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Control center',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Customer register',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Propose customer',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'General ledger',exact:true})).toHaveCount(0);
  const fixture=JSON.parse(fs.readFileSync('docs/browser-customers-result.json')),readHeaders={'X-Company-ID':company,'X-CSRF-Token':identity.csrfToken,...(identity.previewSessionToken?{'X-ERP-Session':identity.previewSessionToken}:{})};
  const denied=await page.context().request.get(base+'/api/v1/accounts',{headers:readHeaders});assert.equal(denied.status(),403);
  await page.getByLabel('Search customers').fill(fixture.number);await page.locator('[data-customer-id="'+fixture.customerId+'"]').getByRole('button').click();await expect(page.getByRole('dialog')).toContainText('12,500.75');await expect(page.getByRole('dialog')).toContainText('No editable balance');await page.getByRole('button',{name:'Amendment history',exact:true}).click();await expect(page.getByRole('button',{name:'Propose amendment',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Close amendments'}).click();
  for(const path of ['/customers/changes','/customers/changes/'+fixture.requestId+'/decide','/customers/'+fixture.customerId+'/amendments','/customers/amendments/'+fixture.requestId+'/decide']){const r=await page.context().request.post(base+'/api/v1'+path,{headers:{...readHeaders,Origin:base,'Idempotency-Key':randomUUID()},data:{}});assert.equal(r.status(),403,path);}
  await page.getByRole('button',{name:'Customer requests',exact:true}).click();await page.locator('[data-customer-id="'+fixture.requestId+'"]').getByRole('button').click();await expect(page.getByRole('button',{name:'Approve customer',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Close customer dialog'}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.deepEqual(errors,[]);
  const result={passed:true,date:new Date().toISOString(),browser:'Chromium',workflow:['Real reset-mail identity with only customer and audit reads','Customer-only default navigation and exact credit-policy display','No editable balance, proposal or review controls','Backend denies both mutation endpoints and generic finance access'],consoleErrors:errors};fs.writeFileSync('docs/browser-customer-access-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{
  if(browser)await browser.close();
  try{if(member)await post('/admin/users/'+member.id+'/access',{active:false,roleIds:[role.id],branchIds:[],expectedVersion:1,reason:'DEMO isolated browser fixture retired after test'});if(headers)await api.post(base+'/api/v1/auth/logout',{headers});}finally{await api.dispose();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
