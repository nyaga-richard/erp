// Regression: genuine cross-site iframe, with ALL cookies stripped at the proxy.
// No screenshots/traces/header dumps: session credentials must never enter artifacts.
const {chromium,expect}=require('@playwright/test');
const https=require('https'),http=require('http'),fs=require('fs'),assert=require('node:assert/strict');
const {execFileSync}=require('child_process');
(async()=>{
 fs.mkdirSync('.cache',{recursive:true});
 if(!fs.existsSync('.cache/preview-key.pem'))execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','.cache/preview-key.pem','-out','.cache/preview-cert.pem','-subj','/CN=localhost','-days','2'],{stdio:'ignore'});
 let strippedResponses=0,sessionRequests=0;
 const server=https.createServer({key:fs.readFileSync('.cache/preview-key.pem'),cert:fs.readFileSync('.cache/preview-cert.pem')},(req,res)=>{
  if(req.headers.host.startsWith('127.0.0.1:')){res.writeHead(200,{'Content-Type':'text/html'});res.end(`<iframe title="ERP preview" src="https://localhost:${server.address().port}" style="width:1400px;height:1000px"></iframe>`);return;}
  const headers={...req.headers,host:'localhost:5173'};delete headers.cookie;if(headers['x-erp-session'])sessionRequests++;
  const proxy=http.request({hostname:'127.0.0.1',port:5173,path:req.url,method:req.method,headers},up=>{const responseHeaders={...up.headers};if(responseHeaders['set-cookie'])strippedResponses++;delete responseHeaders['set-cookie'];res.writeHead(up.statusCode,responseHeaders);up.pipe(res);});
  proxy.on('error',()=>{res.writeHead(502);res.end();});req.pipe(proxy);
 });
 await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));
 const browser=await chromium.launch({args:['--no-sandbox']});const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1600,height:1200}}),page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const credentials=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8')),frame=page.frameLocator('iframe');
 const child=()=>page.frames().find(f=>f.url().startsWith('https://localhost:'));
 async function login(email){
  await frame.getByLabel('Email address').fill(email);await frame.getByLabel('Password',{exact:true}).fill(credentials.password);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/login')&&r.request().method()==='POST');await frame.getByRole('button',{name:'Sign in to workspace'}).click();
  const response=await pending;assert.equal(response.status(),201);const data=await response.json();assert.equal(typeof data.previewSessionToken,'string');
  await expect(frame.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await expect(frame.getByText('Sandbox session — cookies not required.',{exact:true})).toBeVisible();
  // Assert only a boolean, never serialize the token or browser storage to disk/logs.
  assert.equal(await child().evaluate(token=>JSON.stringify({...localStorage,...sessionStorage}).includes(token),data.previewSessionToken),false);
  assert.equal((await ctx.cookies()).length,0);return data.previewSessionToken;
 }
 async function replayStatus(token,path='/auth/me',post=false){return child().evaluate(async({token,path,post})=>{const r=await fetch('/api/v1'+path,{method:post?'POST':'GET',headers:{'Content-Type':'application/json','X-ERP-Session':token,...(post?{'X-CSRF-Token':'forged'}:{})},...(post?{body:'{}'}:{})});return r.status;},{token,path,post});}
 try{
  await page.goto('https://127.0.0.1:'+server.address().port+'/');const token=await login('amina@demo.local');await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();
  assert.equal(await replayStatus(token,'/auth/logout',true),403);
  await frame.getByRole('button',{name:'Sign out',exact:true}).click();await expect(frame.getByLabel('Email address')).toBeVisible();assert.equal(await replayStatus(token),401);
  await login('admin@demo.local');await expect(frame.getByRole('heading',{name:'Control center',exact:true})).toBeVisible();await frame.getByRole('button',{name:'Warehouses',exact:true}).click();await expect(frame.getByRole('button',{name:'Create warehouse',exact:true})).toBeVisible();
  await page.reload();await expect(frame.getByLabel('Email address')).toBeVisible();await expect(frame.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);
  const revoked=await login('admin@demo.local');
  // Deterministically hold an old workspace refresh across self-revocation.
  let releaseRefresh;const held=new Promise(resolve=>{releaseRefresh=resolve;});
  await page.route('**/api/v1/workspace',async route=>{await held;await route.continue().catch(()=>{});});
  const refreshRequested=page.waitForRequest(r=>r.url().endsWith('/api/v1/workspace'));
  await frame.getByRole('button',{name:'My sessions',exact:true}).click();await refreshRequested;
  await frame.getByRole('row').filter({hasText:'This device'}).getByRole('button',{name:'Revoke session',exact:true}).click();await frame.getByRole('button',{name:'Confirm revocation',exact:true}).click();await expect(frame.getByLabel('Email address')).toBeVisible();
  try{await expect(frame.getByRole('button',{name:'Sign in to workspace'})).toBeEnabled();}finally{releaseRefresh();}
  await page.unroute('**/api/v1/workspace');assert.equal(await replayStatus(revoked),401);
  // A new account must not inherit the revoked memory credential.
  await login('amina@demo.local');await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();await frame.getByRole('button',{name:'Sign out',exact:true}).click();await expect(frame.getByLabel('Email address')).toBeVisible();
  assert.ok(strippedResponses>=4);assert.ok(sessionRequests>10);assert.deepEqual(errors,[]);
  const result={passed:true,date:new Date().toISOString(),browser:'Chromium',crossSiteIframe:true,allRequestAndResponseCookiesStripped:true,checks:['Password login without cookies','No credential in localStorage or sessionStorage','Accounting workspace loads','Forged CSRF denied','UI logout revokes server session','Second user enters Control center and warehouses','Reload requires sign-in','UI self-revocation signs out and rejects replay','Revocation during pending refresh leaves sign-in enabled','Fresh sign-in after revocation does not reuse old identity'],consoleErrors:errors,platformTrafficTokenTested:false};
  fs.writeFileSync('docs/browser-preview-memory-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
