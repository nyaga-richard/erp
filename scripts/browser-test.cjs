const {chromium,expect}=require('@playwright/test');
const fs=require('fs');
(async()=>{
 const creds=JSON.parse(fs.readFileSync('.runtime/demo.json','utf8'));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(r.request().method()==='POST' && r.status()>=400)console.error('Failed browser command',r.status(),r.url(),await r.text());});
 const base=process.env.WEB_URL||'http://127.0.0.1:5173';
 async function login(email){await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(creds.password);await page.getByRole('button',{name:'Sign in to workspace'}).click();await expect(page.getByRole('heading',{name:'Your books, in perspective.'})).toBeVisible();await expect(page.getByRole('button',{name:'New journal draft'})).toBeVisible();}
 async function logout(){await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('Email address')).toBeVisible();}
 async function confirm(){await page.getByRole('button',{name:'Confirm action',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
 try{
  await page.goto(base);await login('amina@demo.local');
  await page.getByLabel('Company',{exact:true}).selectOption(creds.companyId);
  await expect(page.getByLabel('Company',{exact:true})).toHaveValue(creds.companyId);
  await expect(page.locator('.sidebar')).toContainText('Karibu Retail');
  await page.getByRole('button',{name:'New journal draft'}).click();
  await expect(page.getByRole('combobox',{name:'Branch',exact:true})).toContainText('Nairobi');
  await page.getByLabel('Description',{exact:true}).fill('DEMO ONLY — reviewed rent classification correction');
  await page.getByLabel('Account line 1',{exact:true}).fill('6100');await page.getByRole('option',{name:'6100 · Rent',exact:true}).click();
  await page.getByLabel('Account line 2',{exact:true}).fill('6200');await page.getByRole('option',{name:'6200 · Utilities',exact:true}).click();
  await page.getByLabel('Debit line 1',{exact:true}).fill('12500.00');
  await page.getByLabel('Credit line 2',{exact:true}).fill('12500.00');
  await page.getByRole('button',{name:'Save journal draft'}).click();await expect(page.getByRole('button',{name:'Submit for approval'})).toBeVisible();
  const number=await page.locator('.page-heading h1').innerText();
  await page.getByRole('button',{name:'Revise source',exact:true}).click();await page.getByLabel('Description',{exact:true}).fill('DEMO ONLY — revised rent classification correction');await page.getByLabel('Revision reason').fill('DEMO revision with retained original creator');await page.getByRole('button',{name:'Save source revision'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText(/Archived revision 1/)).toBeVisible();
  await page.getByRole('button',{name:'Submit for approval'}).click();await confirm();
  await expect(page.getByRole('button',{name:'Independent approver required'})).toBeDisabled();
  await logout();await login('brian@demo.local');
  let releaseSource,sourceRequested,sourceContinued,wasRequested=false;const held=new Promise(resolve=>{releaseSource=resolve;}),arrived=new Promise(resolve=>{sourceRequested=resolve;}),continued=new Promise(resolve=>{sourceContinued=resolve;});
  const holdSource=async route=>{try{if(route.request().method()==='GET'){wasRequested=true;sourceRequested();await held;}await route.continue();}finally{sourceContinued();}};await page.route('**/api/v1/documents/*',holdSource);
  try{await page.getByRole('button',{name:'Documents',exact:true}).click();await page.getByText(number,{exact:true}).click();await arrived;const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/v1/workspace')&&r.ok());await page.getByRole('button',{name:'Refresh',exact:true}).click();await refreshed;}finally{releaseSource();if(wasRequested)await continued;await page.unroute('**/api/v1/documents/*',holdSource);}
  await expect(page.getByRole('button',{name:'Approve journal',exact:true})).toBeVisible({timeout:5000});await page.getByRole('button',{name:'Approve journal',exact:true}).click();await confirm();
  await expect(page.getByRole('button',{name:'Independent poster required'})).toBeDisabled();
  await logout();await login('carol@demo.local');
  await page.getByRole('button',{name:'Documents',exact:true}).click();await page.getByText(number,{exact:true}).click();
  await page.getByRole('button',{name:'Post journal',exact:true}).click();await confirm();
  await expect(page.getByText('POSTED & BALANCED',{exact:true})).toBeVisible();
  await expect(page.locator('.attribution')).toContainText('Amina');await expect(page.locator('.attribution')).toContainText('Brian');await expect(page.locator('.attribution')).toContainText('Carol');
  fs.mkdirSync('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/journal-trace.png',fullPage:true});
  await page.getByRole('button',{name:'Trial balance',exact:true}).click();await expect(page.locator('table')).toContainText('Rent');
  await page.getByRole('button',{name:'Audit trail',exact:true}).click();await expect(page.locator('table')).toContainText('POST');
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.screenshot({path:'docs/screenshots/workspace.png',fullPage:true});
  await page.getByRole('button',{name:'Toggle dark mode'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:'docs/screenshots/dark-mode.png',fullPage:true});
  await page.getByRole('button',{name:'Toggle dark mode'}).click();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Menu',exact:true}).click();await page.getByRole('button',{name:'Delivery roadmap',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Delivery roadmap',exact:true})).toBeVisible();
  await page.screenshot({path:'docs/screenshots/mobile-roadmap.png',fullPage:true});
  if(errors.length)throw Error(errors.join('\n'));
  const report={passed:true,date:new Date().toISOString(),browser:'Chromium',workflow:['Login as Amina','Create balanced draft','Revise and archive original source','Submit','Self-approval disabled','Login as Brian','Document navigation survives concurrent refresh','Independent approval','Self-post disabled','Login as Carol','Independent posting','Original attribution preserved','Source→journal→audit drilldown','Trial balance contains posting','Dark mode','390px responsive navigation'],sourceDocument:number,consoleErrors:errors};
  fs.writeFileSync('docs/browser-test-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(e){await page.screenshot({path:'.cache/finance-failure.png',fullPage:true});console.error(await page.locator('body').innerText());console.error(await page.locator('input:invalid,select:invalid').evaluateAll(els=>els.map(e=>({name:e.name,label:e.getAttribute('aria-label'),message:e.validationMessage}))));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
