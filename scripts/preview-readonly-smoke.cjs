// Read-only local preview check. Does not confirm Arena traffic authorization.
const {chromium,expect}=require('@playwright/test'),fs=require('fs');
(async()=>{
 const base=process.env.PREVIEW_URL??'http://127.0.0.1:5173',browser=await chromium.launch({args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(base+'/');
  const signIn=page.getByRole('button',{name:'Sign in to workspace',exact:true});await expect(signIn).toBeEnabled();
  await expect(page.getByLabel('Email address')).toHaveValue('');await expect(page.getByLabel('Password',{exact:true})).toHaveValue('');
  const health=await(await fetch(base+'/api/health/ready')).json();
  if(response.status()!==200||errors.length||!health.ready)throw Error(JSON.stringify({status:response.status(),errors,health}));
  await page.screenshot({path:'docs/screenshots/login-current.png',fullPage:true});
  const result={date:new Date().toISOString(),passed:true,httpStatus:response.status(),signInEnabled:true,credentialsBlank:true,consoleErrors:errors,ready:health.ready,productionReady:health.productionReady,scope:'Local read-only preview smoke; not actual Arena authorization'};
  fs.writeFileSync('docs/testing/final-preview-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
