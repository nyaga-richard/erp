// Run after render-design.py. Uses the project's existing Playwright Chromium.
const {chromium}=require('@playwright/test'),{pathToFileURL}=require('url'),path=require('path');
(async()=>{
 const root=path.resolve(__dirname,'..'),browser=await chromium.launch({args:['--no-sandbox']});
 try{const page=await browser.newPage();await page.goto(pathToFileURL(path.join(root,'docs/architecture.html')).href);await page.pdf({path:path.join(root,'docs/architecture.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});console.log('Rendered architecture PDF.');}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
