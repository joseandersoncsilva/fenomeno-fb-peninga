import test from 'node:test';
import assert from 'node:assert/strict';
import checkout from '../api/checkout.js';
import webhook from '../api/asaas-production-webhook.js';
import status from '../api/order-status.js';
import config from '../api/checkout-config.js';
import { productionAsaas } from '../api/_lib/production-guard.js';
import { issueProductionStatusAccess } from '../api/_lib/production-status-access.js';
import { quote } from '../api/_lib/production-payment.js';
Object.assign(process.env,{VERCEL_ENV:'production',FBP_PROD_SUPABASE_URL:'https://nnysmymyvsydikdwlprg.supabase.co',
 FBP_PROD_SUPABASE_SECRET_KEY:'fixture',ASAAS_API_KEY:'fixture',FBP_PROD_ASAAS_WEBHOOK_TOKEN:'fixture-webhook-'.repeat(3),
 FBP_PROD_STATUS_SECRET:'fixture-status-'.repeat(3),FBP_PRODUCTION_PAYMENTS_ENABLED:'false',
 FBP_TURNSTILE_SECRET_KEY:'fixture',FBP_TURNSTILE_SITE_KEY:'fixture',FBP_CHECKOUT_ORIGIN:'https://checkout.example.com'});
const data={fullName:'Comprador Ficticio',email:'fixture@example.com',phone:'11900000000',cpf:'52998224725',city:'Cidade Teste',state:'BA',privacy:true,packageType:3,quantity:1,paymentPlan:'entry',antiBotToken:'fixture'};
const reference='FBP-ABC123456789';
const remote={id:'pay_fixture',customer:'cus_fixture',externalReference:reference,billingType:'BOLETO',value:100,status:'PENDING',invoiceUrl:'https://www.asaas.com/i/fixture'};
const event={id:'evt_fixture',event:'PAYMENT_RECEIVED',payment:{id:remote.id,status:'RECEIVED',value:.01}};
const req=(body=data,headers={})=>({method:'POST',body,headers:{origin:process.env.FBP_CHECKOUT_ORIGIN,'x-vercel-forwarded-for':'192.0.2.1','idempotency-key':'fixture-attempt-123','asaas-access-token':process.env.FBP_PROD_ASAAS_WEBHOOK_TOKEN,...headers}});
async function invoke(handler,request=req()){const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await handler(request,res);return res;}
const reply=(body,code=200)=>new Response(JSON.stringify(body),{status:code});
let calls=[];
function mock(handler){global.fetch=async(url,opt={})=>{calls.push({url:String(url),...opt});assert(!String(url).includes('sandbox'));return handler(String(url),opt);};}
test.beforeEach(()=>{calls=[];process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='false';global.fetch=()=>{throw Error('Unexpected network');};});
const originalFetch=global.fetch;
test.after(()=>{global.fetch=originalFetch;process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='false';});
test('disabled checkout 503 and webhook GET 405 without network',async()=>{assert.equal((await invoke(checkout)).code,503);assert.equal((await invoke(webhook,{method:'GET'})).code,405);});
test('invalid/missing webhook token 401 even with sales off',async()=>{for(const token of [undefined,'wrong',[]])assert.equal((await invoke(webhook,req(event,{'asaas-access-token':token}))).code,401);});
function webhookMock({fail=false,processed=false,mismatch=false}={}){
 let applied=0,done=processed;
 mock((url,opt)=>{
  if(url.includes('/v3/payments/')){if(fail)throw Error('timeout');return reply({...remote,id:mismatch?'pay_wrong':remote.id});}
  if(url.includes('/rpc/apply_production_payment')){assert.deepEqual(JSON.parse(opt.body).p_remote,remote);applied++;done=true;return reply({reference,orderStatus:'awaiting_payment'});}
  if(opt.method==='GET')return reply([{asaas_payment_id:remote.id,event_type:event.event,processed_at:done?'2026-10-14':null}]);
  return reply({});
 });return ()=>applied;
}
test('authenticated webhook processes while sales off; forged paid/value ignored; duplicate no reapply',async()=>{const count=webhookMock();assert.equal((await invoke(webhook,req(event))).code,200);assert.equal((await invoke(webhook,req(event))).body.duplicate,true);assert.equal(count(),1);assert.equal(calls.filter(c=>c.url.includes('/v3/')).length,1);});
test('remote timeout returns 503, persists retry error, and later retry succeeds',async()=>{webhookMock({fail:true});assert.equal((await invoke(webhook,req(event))).code,503);assert(calls.some(c=>c.method==='PATCH'));const count=webhookMock();assert.equal((await invoke(webhook,req(event))).code,200);assert.equal(count(),1);});
test('remote identity mismatch never applies financial state',async()=>{const count=webhookMock({mismatch:true});assert.equal((await invoke(webhook,req(event))).code,503);assert.equal(count(),0);});
test('sales pause permits authenticated status but never an Asaas mutation',async()=>{
 await assert.rejects(productionAsaas('/payments',{method:'POST',body:{value:100}}));
 const token=issueProductionStatusAccess(reference);mock(()=>reply([{status:'entry_paid',remaining_balance_cents:190000}]));
 assert.equal((await invoke(status,req({reference,statusAccess:token}))).body.status,'entry_paid');
 assert.equal((await invoke(status,req({reference,statusAccess:token+'x'}))).code,401);
});
test('production config never falls back to sandbox; enabling requires anti-abuse config',async()=>{
 assert.equal((await invoke(config,{method:'GET'})).body.environment,'production');
 process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';const secret=process.env.FBP_TURNSTILE_SECRET_KEY;delete process.env.FBP_TURNSTILE_SECRET_KEY;
 assert.equal((await invoke(checkout)).code,503);process.env.FBP_TURNSTILE_SECRET_KEY=secret;
});
function checkoutMock({allowed=true,proof=true,reservation=null,timeout=false,badRemote=false}={}){
 mock((url,opt)=>{
  if(url.includes('consume_production_checkout_limit')){const b=JSON.parse(opt.body);assert.match(b.p_ip,/^[a-f0-9]{64}$/);assert(!opt.body.includes(data.cpf));return reply({allowed});}
  if(url.includes('siteverify'))return reply({success:proof,hostname:'checkout.example.com',action:'checkout'});
  if(url.includes('reserve_production_checkout'))return reply(reservation||{claimed:true,customer:{id:'customer-fixture',asaas_customer_id:'cus_fixture'},order:{id:'order-fixture',public_reference:reference,initial_due_cents:10000,total_cents:200000}});
  if(url.includes('/v3/customers/cus_fixture'))return reply({id:'cus_fixture',mobilePhone:'11900000000'});
  if(url.includes('/v3/payments?'))return reply({data:[]});
  if(url.endsWith('/v3/payments')){assert.equal(JSON.parse(opt.body).value,100);assert(!('installmentCount' in JSON.parse(opt.body)));if(timeout)throw Error('uncertain timeout');return reply(remote);}
  if(url.includes('/v3/payments/'))return reply({...remote,...(badRemote?{value:1}:{})});
  if(url.includes('/rpc/apply_production_payment'))return reply({reference,orderStatus:'awaiting_payment'});
  if(opt.method==='PATCH')return reply({});
  throw Error('Unexpected request '+url);
 });
}
test('rate limit and CAPTCHA stop charge creation on server',async()=>{
 process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';
 for(const options of [{allowed:false},{proof:false}]){checkoutMock(options);const r=await invoke(checkout);assert.equal(r.code,options.allowed===false?429:403);assert(!calls.some(c=>c.url.includes('/v3/')));calls=[];}
 checkoutMock();assert.equal((await invoke(checkout,req(data,{origin:'https://evil.example'}))).code,403);assert.equal(calls.length,0);
 assert.equal((await invoke(checkout,req({...data,antiBotToken:''}))).code,400);
});
test('order limits and completed replay never create a second charge',async()=>{
 process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';
 for(const [reservation,code] of [[{limited:true},429],[{conflict:true},409],[{claimed:false,request:{status:'needs_review'}},409],[{claimed:false,request:{status:'completed',response:{reference}}},200]]){
  calls=[];checkoutMock({reservation});assert.equal((await invoke(checkout)).code,code);assert(!calls.some(c=>c.url.includes('/v3/')));
 }
});
test('forged client amount and paid state cannot override server price or remote state',async()=>{
 process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';checkoutMock();const r=await invoke(checkout,req({...data,value:.01,status:'paid',initial_due_cents:1}));assert.equal(r.code,201);assert.equal(r.body.amount,100);assert.equal(r.body.orderStatus,'awaiting_payment');
});
test('uncertain POST not retried, reservation frozen for reconciliation',async()=>{
 process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';checkoutMock({timeout:true});assert.equal((await invoke(checkout)).code,502);assert.equal(calls.filter(c=>c.url.endsWith('/v3/payments')&&c.method==='POST').length,1);assert(calls.some(c=>c.method==='PATCH'&&JSON.parse(c.body).status==='needs_review'));
});
test('wrong remote amount cannot complete checkout',async()=>{process.env.FBP_PRODUCTION_PAYMENTS_ENABLED='true';checkoutMock({badRemote:true});assert.equal((await invoke(checkout)).code,502);assert(!calls.some(c=>c.url.includes('apply_production_payment')));});
test('business rules: entry per unit, 10% cash discount, no future installments',()=>{
 for(const [packageType,paymentPlan,totalCents,initialCents] of [[3,'entry',200000,10000],[1,'entry',100000,10000],[3,'cash',180000,180000],[1,'cash',90000,90000]]){
  for(const quantity of [1,2,100])assert.deepEqual(quote({packageType,quantity,paymentPlan}),{totalCents:totalCents*quantity,initialCents:initialCents*quantity});
 }
});
test('webhook PAYMENT_RECEIVED uses remote PIX snapshot, ignores posted fields and retries after RPC failure',async()=>{
 const pix={...remote,status:'RECEIVED',billingType:'PIX',subscription:null,installment:null};
 let fail=true,processed=false,applied=0;
 mock((url,opt)=>{
  if(url.includes('/v3/payments/'))return reply(pix);
  if(url.includes('/rpc/apply_production_payment')){assert.deepEqual(JSON.parse(opt.body).p_remote,pix);if(fail)return reply({code:'P0001',message:'Payment identity or amount mismatch'},400);processed=true;applied++;return reply({reference,orderStatus:'entry_paid'});}
  if(opt.method==='GET')return reply([{asaas_payment_id:remote.id,event_type:event.event,processed_at:processed?'2026-10-15':null}]);
  return reply({});
 });
 assert.equal((await invoke(webhook,req(event))).code,503);fail=false;
 assert.equal((await invoke(webhook,req(event))).code,200);
 assert.equal((await invoke(webhook,req(event))).body.duplicate,true);assert.equal(applied,1);
});
test('GET reconciliation preview freshly reads existing payment and never writes or exposes buyer data',async()=>{
 const {default:reconcile}=await import('../api/reconcile-production.js');
 process.env.FBP_PROD_RECONCILE_SECRET='fixture-reconcile-'.repeat(3);
 mock((url,opt)=>{
  assert.equal(opt.method,'GET');
  if(url.includes('/orders?'))return reply([{id:'order-fixture',customer_id:'customer-fixture',initial_due_cents:10000,total_cents:200000,status:'awaiting_payment'}]);
  if(url.includes('/payments?'))return reply([{order_id:'order-fixture',amount_cents:10000,billing_type:'BOLETO',status:'PENDING'}]);
  if(url.includes('/customers?'))return reply([{asaas_customer_id:'cus_fixture'}]);
  if(url.includes('/v3/payments/'))return reply({...remote,status:'RECEIVED',billingType:'PIX',email:'private@example.invalid'});
  throw Error('Unexpected operation');
 });
 const request={method:'GET',query:{reference,paymentId:remote.id},headers:{'x-reconciliation-secret':process.env.FBP_PROD_RECONCILE_SECRET}};
 const r=await invoke(reconcile,request);assert.equal(r.code,200);assert.equal(r.body.readOnly,true);assert.equal(r.body.verified,true);assert.equal(r.body.remoteStatus,'RECEIVED');assert.equal(r.body.remoteBillingType,'PIX');
 assert(!JSON.stringify(r.body).includes('private@example.invalid'));assert(!JSON.stringify(r.body).includes('cus_fixture'));
 assert.equal((await invoke(reconcile,{...request,headers:{}})).code,401);
 delete process.env.FBP_PROD_RECONCILE_SECRET;
});
