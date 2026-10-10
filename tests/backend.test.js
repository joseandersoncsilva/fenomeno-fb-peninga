import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://database.invalid';
process.env.SUPABASE_SECRET_KEY='fake-test-server-key';
process.env.ASAAS_SANDBOX_API_KEY='fake-sandbox-key';
process.env.ASAAS_ENV='sandbox';
process.env.VERCEL_ENV='preview';
process.env.VERCEL_GIT_COMMIT_REF='feat/supabase-asaas-backend';
process.env.CHECKOUT_TEST_TOKEN='test-only-checkout-token';
process.env.ASAAS_WEBHOOK_TOKEN='test-only-webhook-token';
const {default:checkout,normalizedBuyer,cpfValid}=await import('../api/checkout-sandbox.js');
const {default:webhook}=await import('../api/asaas-webhook.js');
const {default:reconcile}=await import('../api/reconcile-sandbox.js');
const {default:status}=await import('../api/order-status-sandbox.js');
const {safeEquals,invoiceURL}=await import('../api/_lib/sandbox.js');
const data={fullName:'Comprador Ficticio',email:'fixture@example.com',phone:'11900000000',cpf:'52998224725',city:'Cidade Teste',state:'BA',privacy:true,packageType:3,quantity:1,paymentPlan:'entry'};
function req(body=data,headers={'x-checkout-test-token':process.env.CHECKOUT_TEST_TOKEN,'idempotency-key':'test-idempotency-key-123'}){return {method:'POST',headers,body};}
async function invoke(handler,request){const r={code:0,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler(request,r);return r;}
function reply(body,code=200){return new Response(JSON.stringify(body),{status:code,headers:{'content-type':'application/json'}});}

test('test credentials compared safely; reject array headers',()=>{assert(safeEquals('x','x'));assert(!safeEquals(['x'],'x'));assert(!safeEquals('x','xy'));});
test('CPF, bounded quantity, privacy and state validation',()=>{assert(cpfValid(data.cpf));assert(!cpfValid('11111111111'));assert(normalizedBuyer(data));for(const bad of [{quantity:101},{quantity:1.5},{privacy:false},{state:'XX'},{paymentPlan:'card'},{cpf:'000'}])assert.equal(normalizedBuyer({...data,...bad}),null);});
test('invoice links restricted to Sandbox',()=>{assert.equal(invoiceURL('https://sandbox.asaas.com/i/test'),'https://sandbox.asaas.com/i/test');for(const url of ['javascript:alert(1)','https://asaas.com/i/test','https://sandbox.asaas.com.evil.test/i/test'])assert.throws(()=>invoiceURL(url));});
test('production and wrong branch fail closed without network access',async()=>{const original=global.fetch;global.fetch=()=>{throw new Error('Unexpected network');};try{process.env.VERCEL_ENV='production';assert.equal((await invoke(checkout,req())).code,503);assert.equal((await invoke(webhook,req())).code,503);process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='main';assert.equal((await invoke(checkout,req())).code,503);}finally{process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='feat/supabase-asaas-backend';global.fetch=original;}});
test('unauthorized endpoints and malformed inputs rejected before persistence',async()=>{const original=global.fetch;global.fetch=()=>{throw new Error('Unexpected network');};try{for(const handler of [checkout,webhook,reconcile,status])assert.equal((await invoke(handler,req({},{}))).code,401);assert.equal((await invoke(checkout,req({...data,quantity:0}))).code,400);assert.equal((await invoke(checkout,req(data,{'x-checkout-test-token':process.env.CHECKOUT_TEST_TOKEN}))).code,400);}finally{global.fetch=original;}});
test('completed checkout replay performs no Asaas POST',async()=>{const original=global.fetch;let calls=0;global.fetch=async(url)=>{calls++;assert(String(url).includes('/rpc/reserve_sandbox_checkout'));return reply({claimed:false,request:{status:'completed',response:{reference:'FBP-ABC123456789',environment:'sandbox'}}});};try{const r=await invoke(checkout,req());assert.equal(r.code,200);assert.equal(r.body.replayed,true);assert.equal(calls,1);}finally{global.fetch=original;}});
test('in-progress and body-conflict reservations never create charges',async()=>{const original=global.fetch;try{for(const result of [{conflict:true},{claimed:false,request:{status:'needs_review'}}]){let calls=0;global.fetch=async()=>{calls++;return reply(result);};assert.equal((await invoke(checkout,req())).code,409);assert.equal(calls,1);}}finally{global.fetch=original;}});
test('duplicate webhook acknowledged without remote lookup',async()=>{const original=global.fetch;let calls=0;global.fetch=async(url)=>{calls++;assert(!String(url).includes('api-sandbox.asaas.com'));return calls===1?new Response(null,{status:201}):reply([{asaas_payment_id:'pay_test123',event_type:'PAYMENT_RECEIVED',processed_at:'2026-10-10T00:00:00Z'}]);};try{const r=await invoke(webhook,req({id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test123'}},{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN}));assert.equal(r.code,200);assert.equal(r.body.duplicate,true);assert.equal(calls,2);}finally{global.fetch=original;}});
test('webhook uses API snapshot instead of forged payment value and status',async()=>{const original=global.fetch;const remote={id:'pay_test123',status:'PENDING',value:100,externalReference:'FBP-ABC123456789'};let rpc;global.fetch=async(url,options)=>{url=String(url);if(url.includes('/rpc/apply_sandbox_payment')){rpc=JSON.parse(options.body);return reply({orderStatus:'awaiting_payment'});}if(url.includes('api-sandbox.asaas.com'))return reply(remote);if(options.method==='POST')return new Response(null,{status:201});return reply([{asaas_payment_id:'pay_test123',event_type:'PAYMENT_RECEIVED',processed_at:null}]);};try{const r=await invoke(webhook,req({id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test123',status:'RECEIVED',value:0.01}},{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN}));assert.equal(r.code,200);assert.deepEqual(rpc.p_remote,remote);}finally{global.fetch=original;}});
test('API identity mismatch returns retry and never acknowledges financial write',async()=>{const original=global.fetch;let applied=false;global.fetch=async(url,options)=>{url=String(url);if(url.includes('/rpc/'))applied=true;if(url.includes('api-sandbox'))return reply({id:'pay_wrong'});if(options.method==='GET')return reply([{asaas_payment_id:'pay_test123',event_type:'PAYMENT_RECEIVED',processed_at:null}]);return new Response(null,{status:201});};try{const r=await invoke(webhook,req({id:'evt_test',event:'PAYMENT_RECEIVED',payment:{id:'pay_test123'}},{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN}));assert.equal(r.code,503);assert.equal(applied,false);}finally{global.fetch=original;}});


test('uncertain Asaas POST is not retried and freezes the reservation for review',async()=>{
 const original=global.fetch;let posts=0,held=false;
 global.fetch=async(url,options)=>{
  url=String(url);
  if(url.includes('/rpc/reserve_sandbox_checkout'))return reply(held?{claimed:false,request:{status:'needs_review'}}:{claimed:true,request:{},customer:{id:'customer-fixture',asaas_customer_id:'cus_fixture'},order:{id:'order-fixture',public_reference:'FBP-ABC123456789',initial_due_cents:10000}});
  if(url.includes('api-sandbox.asaas.com/v3/payments?'))return reply({data:[]});
  if(url.endsWith('/v3/payments')&&options.method==='POST'){posts++;throw new Error('Simulated timeout after an uncertain POST');}
  if(url.includes('checkout_requests')&&options.method==='PATCH'){held=JSON.parse(options.body).status==='needs_review';return new Response(null,{status:204});}
  if(url.includes('/orders?'))return new Response(null,{status:204});
  throw new Error('Unexpected request');
 };
 try {assert.equal((await invoke(checkout,req())).code,502);assert(held);assert.equal((await invoke(checkout,req())).code,409);assert.equal(posts,1);}
 finally{global.fetch=original;}
});
