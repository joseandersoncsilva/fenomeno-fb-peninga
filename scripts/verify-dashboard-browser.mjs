// Isolated browser fixtures only. No Production or Asaas requests.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
await mkdir('artifacts',{recursive:true});
const server=createServer(async(req,res)=>{try{const path=resolve('public','.'+(req.url.endsWith('/')?req.url+'index.html':req.url));if(!path.startsWith(resolve('public')+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'application/javascript'})[extname(path)]||'text/plain');res.end(await readFile(path));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
try{
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844],['small-mobile',320,740]]){
  const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();let logged=false,empty=false,fail=false,expired=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const url=route.request().url();if(!url.startsWith(base))return route.abort();if(!url.includes('/api/'))return route.continue();
   const action=new URL(url).searchParams.get('action');
   if(action==='login'){logged=true;return route.fulfill({json:{ok:true}});}
   if(action==='logout'){logged=false;return route.fulfill({json:{ok:true}});}
   if(!logged||expired)return route.fulfill({status:401,json:{error:'Sessão expirada. Entre novamente.'}});
   if(fail)return route.fulfill({status:503,json:{error:'Não foi possível atualizar.'}});
   return route.fulfill({json:{metrics:{orders:empty?0:1,entryReceived:empty?0:1,receivedCents:empty?0:10000,contractedCents:empty?0:200000,pendingPayments:0,reviewOrders:0},orders:empty?[]:[{reference:'FBP-ABC123456789',buyer:'Comprador de teste <img src=x onerror=alert(1)>',phone:'11900000000',createdAt:'2026-10-15T12:00:00Z',package:'package_3',quantity:1,totalCents:200000,initialCents:10000,status:'entry_paid'}],updatedAt:'2026-10-15T12:00:00Z',expiresAt:Date.now()+3600000}});
  });
  await page.goto(base+'/painel/');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Sessão'));
  assert(await page.locator('#dashboard').isHidden());await page.locator('#secret').fill('fixture-not-a-real-password');await page.locator('button[type=submit]').click();await page.locator('#dashboard').waitFor({state:'visible'});
  assert.equal(await page.locator('#secret').inputValue(),'');assert.match(await page.locator('#orders').innerText(),/09:00/);assert.match(await page.locator('#metrics').innerText(),/100,00/);assert.equal(await page.locator('#orders img').count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0));
  await page.screenshot({path:`artifacts/dashboard-${name}.png`,fullPage:true});
  fail=true;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Não foi'));fail=false;empty=true;await page.locator('#refresh').click();await page.getByText('Nenhum pedido registrado.').waitFor();
  expired=true;await page.locator('#refresh').click();await page.locator('#login').waitFor({state:'visible'});assert.equal(await page.locator('#orders').innerText(),'');
  expired=false;empty=false;await page.locator('#secret').fill('fixture-not-a-real-password');await page.locator('button[type=submit]').click();await page.locator('#dashboard').waitFor({state:'visible'});await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});assert.equal(await page.locator('#orders').innerText(),'');assert.deepEqual(errors,[]);await context.close();
  console.log(name+': login, metrics, XSS, layout, empty/error states, expiry and logout passed');
 }
}finally{await browser.close();server.close();}
