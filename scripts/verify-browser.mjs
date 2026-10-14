// No external requests or payments: browser API and Turnstile responses are fixtures.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
await mkdir('artifacts',{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve('public','.'+(req.url.endsWith('/')?req.url+'index.html':req.url));if(!path.startsWith(resolve('public')+'/'))throw Error();res.setHeader('content-type',({'.html':'text/html','.png':'image/png','.webp':'image/webp'})[extname(path)]||'text/plain');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const results=[];
try{
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]){
 const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let enabled=true,fail=false,posts=0,keys=[],status='entry_paid';
 await page.route('**/*',async route=>{
  const url=route.request().url();
  if(url.startsWith('https://challenges.cloudflare.com/'))return route.fulfill({contentType:'application/javascript',body:"window.turnstile={render:(el,o)=>{o.callback('fixture-proof');return 1;},reset:()=>{}}"});
  if(url===base+'/api/checkout-config')return route.fulfill({json:{enabled,environment:'production',realPaymentsEnabled:enabled,turnstileSiteKey:'fixture'}});
  if(url===base+'/api/order-status')return route.fulfill({json:{status,remaining_balance_cents:190000}});
  if(url===base+'/api/checkout'){
   posts++;keys.push(route.request().headers()['idempotency-key']);
   await new Promise(r=>setTimeout(r,200));
   return route.fulfill({status:fail?503:201,json:fail?{error:'Temporariamente indisponível'}:{reference:'FBP-ABC123456789',statusAccess:'fixture-access',amount:100,dueDate:'2026-10-19',invoiceUrl:'https://www.asaas.com/i/fixture',environment:'production'}});
  }
  if(!url.startsWith(base))return route.abort();return route.continue();
 });
 await page.goto(base+'/comprar/');
 await page.locator('.approved-image img').evaluate(img=>img.decode());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`artifacts/${name}-sales.png`,fullPage:true});
 for(let i=0;i<3;i++)await page.locator('#wizard-next').click();
 await page.locator('#wizard-next').click();assert(await page.locator('#wizard-error').isVisible());
 for(const [field,value] of Object.entries({fullName:'Comprador Ficticio',cpf:'52998224725',phone:'11900000000',email:'fixture@example.com',city:'Cidade Teste'}))await page.locator(`[name="${field}"]`).fill(value);
 await page.locator('[name="state"]').selectOption('BA');await page.locator('[name="privacy"]').check();await page.locator('#wizard-next').click();
 assert(!(await page.locator('#sandbox-token').isVisible()));assert.match(await page.locator('#review-initial').innerText(),/100,00/);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`artifacts/${name}-review.png`,fullPage:true});
 if(name==='desktop'){
  fail=true;await page.locator('#generate-boleto').click();assert(await page.locator('#generate-boleto').isDisabled());await page.waitForFunction(()=>document.querySelector('#checkout-result').textContent.includes('Temporariamente'));assert(!(await page.locator('#generate-boleto').isDisabled()));
  fail=false;await page.reload();for(let i=0;i<3;i++)await page.locator('#wizard-next').click();
  for(const [field,value] of Object.entries({fullName:'Comprador Ficticio',cpf:'52998224725',phone:'11900000000',email:'fixture@example.com',city:'Cidade Teste'}))await page.locator(`[name="${field}"]`).fill(value);
  await page.locator('[name="state"]').selectOption('BA');await page.locator('[name="privacy"]').check();await page.locator('#wizard-next').click();
 }
 await page.locator('#generate-boleto').click();await page.locator('#order-receipt').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#receipt-status').textContent==='Entrada paga');
 assert.match(await page.locator('#receipt-balance').innerText(),/1\.900,00/);
 const before=posts;enabled=false;await page.reload();await page.locator('#order-receipt').waitFor({state:'visible'});
 assert.equal(posts,before);assert(await page.locator('#generate-boleto').isHidden());assert.equal(await page.locator('#invoice-link').innerText(),'ABRIR MEU BOLETO');
 await page.screenshot({path:`artifacts/${name}-receipt.png`,fullPage:true});
 if(name==='desktop')assert.equal(keys[0],keys[1]);
 await page.evaluate(()=>localStorage.clear());await page.reload();assert(await page.locator('#generate-boleto').isDisabled());
 assert.deepEqual(errors,[]);results.push({viewport:name,width,height,passed:true,checkoutRequests:posts,externalRequests:'blocked / mocked'});await context.close();
}
console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();}
