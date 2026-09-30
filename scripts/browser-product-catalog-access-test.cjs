const {chromium,expect,request}=require('@playwright/test');
const fs=require('fs'),assert=require('node:assert/strict'),{randomUUID}=require('crypto'),{execFileSync}=require('child_process');
(async()=>{
 const base=process.env.WEB_URL||'http://127.0.0.1:5173',company='10000000-0000-4000-8000-000000000001',stamp=Date.now(),email=`product.catalog.${stamp}@example.test`,password=randomUUID()+'Aa9!';
 const credentials=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8')),api=await request.newContext({extraHTTPHeaders:{Origin:base,'X-ERP-Session-Transport':'memory'}});let browser,headers,member,role;
 async function post(path,data,authenticated=true){const response=await api.post(base+'/api/v1'+path,{data,headers:authenticated?{...headers,'Idempotency-Key':randomUUID()}:undefined});assert.ok(response.ok(),path+' returned '+response.status());return response.json();}
 try{
  const login=await post('/auth/login',{email:'admin@demo.local',password:credentials.password},false);headers={'X-Company-ID':company,'X-CSRF-Token':login.csrfToken,...(login.previewSessionToken?{'X-ERP-Session':login.previewSessionToken}:{})};
  role=await post('/admin/roles',{name:'DEMO product catalog observer '+stamp,permissions:['workspace:view','products:view','audit:view'],reason:'DEMO isolated least-privilege navigation regression'});
  member=await post('/admin/users',{email,name:'DEMO product catalog observer '+stamp,roleIds:[role.id],branchIds:[],reason:'DEMO isolated least-privilege navigation regression'});
  await post('/auth/password-reset/request',{email},false);execFileSync(process.execPath,['scripts/auth-mail-worker.cjs','--once'],{stdio:'pipe'});
  let mail;await expect.poll(()=>{mail=fs.readdirSync('.runtime/mail').map(f=>JSON.parse(fs.readFileSync('.runtime/mail/'+f,'utf8'))).find(m=>m.to===email);return !!mail;},{timeout:10000}).toBe(true);
  await post('/auth/password-reset/consume',{token:mail.text.match(/#reset=([A-Za-z0-9_-]+)/)[1],password},false);
  browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);const signedIn=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login'));await page.getByRole('button',{name:'Sign in to workspace'}).click();const identity=await (await signedIn).json();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Control center',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Product reference masters',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'New product reference'})).toHaveCount(0);await expect(page.getByRole('button',{name:'General ledger',exact:true})).toHaveCount(0);
  const denied=await page.context().request.get(base+'/api/v1/accounts',{headers:{'X-Company-ID':company,...(identity.previewSessionToken?{'X-ERP-Session':identity.previewSessionToken}:{})}});assert.equal(denied.status(),403);
  await page.getByRole('button',{name:'Products',exact:true}).click();await expect(page.getByRole('heading',{name:'Product catalog'})).toBeVisible();await expect(page.getByRole('button',{name:'Propose product',exact:true})).toHaveCount(0);
  const fixture=JSON.parse(fs.readFileSync('docs/browser-products-result.json'));const readHeaders={'X-Company-ID':company,...(identity.previewSessionToken?{'X-ERP-Session':identity.previewSessionToken}:{})};
  const detail=await page.context().request.get(base+'/api/v1/admin/products/'+fixture.productId,{headers:readHeaders});assert.equal(detail.status(),200);assert.equal((await detail.json()).purchase_price,null);
  const lookup=await page.context().request.get(base+'/api/v1/admin/products/lookup?barcode='+fixture.barcode,{headers:readHeaders});assert.equal(lookup.status(),200);assert.equal((await lookup.json()).purchase_price,null);
  const history=await page.context().request.get(base+'/api/v1/admin/product-changes',{headers:readHeaders});assert.equal(history.status(),200);assert.ok((await history.json()).data.every(r=>r.purchase_price===null));
  const audit=await page.context().request.get(base+'/api/v1/audit',{headers:readHeaders});assert.equal(audit.status(),200);const events=(await audit.json()).filter(r=>r.entity_type==='PRODUCT_CONFIGURATION');assert.ok(events.length);assert.ok(events.every(r=>r.new_values.redacted===true));
  await page.getByLabel('Exact barcode lookup').fill(fixture.barcode);await page.getByRole('button',{name:'Find barcode',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Restricted');await expect(page.getByRole('dialog')).not.toContainText('50.123456');await page.getByRole('button',{name:'Close product dialog'}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();assert.deepEqual(errors,[]);
  const result={passed:true,date:new Date().toISOString(),browser:'Chromium',workflow:['Isolated product reader with audit access but no purchase-cost permission','Credentials established through real development mail/reset flow','Product-only navigation and default control-center tab','No implicit proposing or financial access','Finance endpoint denied by backend','Product catalog/detail/barcode/history purchase costs masked','No product proposal authority','Audit access cannot reveal purchase-cost snapshots'],consoleErrors:errors};fs.writeFileSync('docs/browser-product-catalog-access-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{
  if(browser)await browser.close();
  try{if(member)await post('/admin/users/'+member.id+'/access',{active:false,roleIds:[role.id],branchIds:[],expectedVersion:1,reason:'DEMO isolated browser fixture retired after test'});if(headers)await api.post(base+'/api/v1/auth/logout',{headers});}finally{await api.dispose();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
