// A real cross-site iframe (not a top-level localhost-only login test).
const {chromium,expect}=require('@playwright/test');const https=require('https'),http=require('http'),fs=require('fs');const {execFileSync}=require('child_process');
(async()=>{
 // Separate ephemeral API verifies the default cookie-only mode without changing the live preview.
 process.env.ENABLE_PREVIEW_MEMORY_SESSION='false';
 const {bootstrap}=require('../apps/api/build/main.js'),{Db}=require('../apps/api/build/db.js');
 const cookieApi=await bootstrap(0),apiPort=cookieApi.getHttpServer().address().port;
 fs.mkdirSync('.cache',{recursive:true});if(!fs.existsSync('.cache/preview-key.pem'))execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout','.cache/preview-key.pem','-out','.cache/preview-cert.pem','-subj','/CN=localhost','-days','2'],{stdio:'ignore'});
 const server=https.createServer({key:fs.readFileSync('.cache/preview-key.pem'),cert:fs.readFileSync('.cache/preview-cert.pem')},(req,res)=>{if(req.headers.host.startsWith('127.0.0.1:')){res.writeHead(200,{'Content-Type':'text/html'});res.end(`<iframe title="ERP preview" src="https://localhost:${server.address().port}" style="width:1400px;height:1000px"></iframe>`);return;}const proxy=http.request({hostname:'127.0.0.1',port:req.url.startsWith('/api/')?apiPort:5173,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:5173'}},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});proxy.on('error',()=>{res.writeHead(502);res.end()});req.pipe(proxy)});
 await new Promise(resolve=>server.listen(0,'0.0.0.0',resolve));const port=server.address().port;
 const browser=await chromium.launch({args:['--no-sandbox']});const ctx=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1600,height:1200}});const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>console.error('Failed resource:',new URL(r.url()).pathname,r.failure()));const csrfFailures=[];page.on('response',async r=>{if(r.url().includes('/api/v1/auth/'))csrfFailures.push({path:new URL(r.url()).pathname,status:r.status()})});
 let releaseBoot,arrivedBoot,continuedBoot,bootHeld=false;const bootGate=new Promise(r=>{releaseBoot=r;}),bootArrived=new Promise(r=>{arrivedBoot=r;}),bootContinued=new Promise(r=>{continuedBoot=r;});
 const holdBootstrap=async route=>{if(bootHeld){await route.continue();return;}bootHeld=true;try{const response=await route.fetch();arrivedBoot();await bootGate;await route.fulfill({response});}finally{continuedBoot();}};
 // A stale tab CSRF value triggers the cookie probe without inventing a session.
 await page.addInitScript(()=>{if(location.hostname==='localhost'&&!sessionStorage.getItem('bootstrap-test-initialized')){sessionStorage.setItem('erp-csrf','stale-bootstrap-test-value');sessionStorage.setItem('bootstrap-test-initialized','1');}});
 await page.route('**/api/v1/auth/me',holdBootstrap);
 try{
  await page.goto('https://127.0.0.1:'+port+'/');const frame=page.frameLocator('iframe');const creds=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8'));
  await bootArrived;try{await expect(frame.getByLabel('Email address')).toBeDisabled();await expect(frame.getByLabel('Password',{exact:true})).toBeDisabled();}finally{releaseBoot();await bootContinued;await page.unroute('**/api/v1/auth/me',holdBootstrap);}
  await frame.getByLabel('Email address').fill('amina@demo.local');await frame.getByLabel('Password',{exact:true}).fill(creds.password);await frame.getByRole('button',{name:'Sign in to workspace'}).click();
  if(process.env.EXPECT_BLOCKED==='true'){
   await expect(frame.getByLabel('Email address')).toBeVisible();await expect.poll(()=>csrfFailures.some(r=>r.path.endsWith('/auth/login')&&r.status===201)&&csrfFailures.filter(r=>r.path.endsWith('/auth/me')&&r.status===401).length>=2).toBe(true);console.log('Reproduced: password accepted (201), session missing in cross-site iframe (401).');return;
  }
  await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();
  const cookies=await ctx.cookies();const session=cookies.find(c=>c.name==='__Host-erp_preview');if(!session||!session.httpOnly||!session.secure||session.sameSite!=='None'||!session.partitionKey)throw Error('Expected a secure HttpOnly partitioned session.');
  // Reload both parent and child to check the cookie persists in this partition.
  await page.reload();await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();
  const child=page.frames().find(f=>f.url().startsWith('https://localhost:'));const csrfStatus=await child.evaluate(async()=>{const r=await fetch('/api/v1/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'forged'},body:'{}'});return r.status});if(csrfStatus!==403)throw Error('Embedded session must retain CSRF protection.');
  // Lost/stale per-tab CSRF must lead to reauthentication, never a dead-end workspace.
  await child.evaluate(()=>sessionStorage.setItem('erp-csrf','stale-after-login'));await page.reload();await expect(frame.getByRole('button',{name:'Sign in to workspace',exact:true})).toBeEnabled();await expect(frame.getByRole('button',{name:'New journal draft'})).toHaveCount(0);
  await frame.getByLabel('Email address').fill('amina@demo.local');await frame.getByLabel('Password',{exact:true}).fill(creds.password);await frame.getByRole('button',{name:'Sign in to workspace'}).click();await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();
  const resumed=page.frames().find(f=>f.url().startsWith('https://localhost:'));await resumed.evaluate(()=>sessionStorage.removeItem('erp-csrf'));await page.reload();await expect(frame.getByRole('button',{name:'Sign in to workspace',exact:true})).toBeEnabled();await expect(frame.getByRole('button',{name:'New journal draft'})).toHaveCount(0);
  await frame.getByLabel('Email address').fill('amina@demo.local');await frame.getByLabel('Password',{exact:true}).fill(creds.password);await frame.getByRole('button',{name:'Sign in to workspace'}).click();await expect(frame.getByRole('button',{name:'New journal draft'})).toBeVisible();
  await frame.getByRole('button',{name:'Sign out',exact:true}).click();await expect(frame.getByLabel('Email address')).toBeVisible();if((await ctx.cookies()).some(c=>c.name==='__Host-erp_preview'))throw Error('Logout did not remove partitioned cookie.');
  if(errors.length)throw Error(errors.join('\n'));const result={passed:true,date:new Date().toISOString(),browser:'Chromium',parentOrigin:'https://127.0.0.1:<ephemeral>',childOrigin:'https://localhost:<ephemeral>',checks:['Sign-in disabled until held cookie bootstrap completes','Stale cookie/CSRF context requires sign-in','Missing tab CSRF requires sign-in','Cross-site iframe password login','Secure HttpOnly partitioned cookie','Session survives frame reload','Forged CSRF remains denied','Logout clears matching partitioned cookie'],consoleErrors:errors,platformTrafficTokenTested:false};fs.writeFileSync('docs/browser-embedded-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(e){console.error('Authentication responses (no credentials):',csrfFailures);console.error('Frames:',page.frames().map(f=>f.url()));console.error('Page errors:',errors);console.error(await page.locator('body').innerText());throw e;}finally{releaseBoot();await browser.close();await new Promise(resolve=>server.close(resolve));await cookieApi.get(Db).pool.end();await cookieApi.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
