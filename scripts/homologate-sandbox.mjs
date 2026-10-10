// Opt-in, one execution per run ID, only inside the authorized Preview branch.
// Existing credentials stay inside Vercel. No credentials or bypass URLs are logged.
import assert from 'node:assert/strict';
import { asaas,sandboxReady } from '../api/_lib/sandbox.js';
import { db } from '../api/_lib/db.js';

const run=process.env.FBP_SANDBOX_HOMOLOGATION;
assert(sandboxReady(),'Only the Sandbox Preview branch can run homologation');
assert(/^[A-Za-z0-9_-]{16,100}$/.test(run),'Invalid run ID');
assert(process.env.CHECKOUT_TEST_TOKEN && process.env.ASAAS_WEBHOOK_TOKEN,'Missing test credentials');
const inserted=await db('sandbox_verification_runs?on_conflict=run_id',{method:'POST',body:{run_id:run,status:'running'},prefer:'resolution=ignore-duplicates,return=representation'});
if(!inserted.length) {
  console.log('SANDBOX_HOMOLOGATION: existing run; no new charge created');
} else {
 let step='inspect_webhook';
 const results={runId:run,environment:'sandbox',cases:[],checks:[]};
 try {
  const hooks=await asaas('/webhooks?limit=100');
  const candidates=(hooks.data||[]).filter(h=>{
   try {const u=new URL(h.url);return u.protocol==='https:'&&u.hostname.startsWith('fenomeno-fb-peninga-git-')&&u.hostname.endsWith('-jose-andersons-projects-625eb4e4.vercel.app')&&u.pathname==='/api/asaas-webhook';}catch{return false;}
  });
  assert.equal(candidates.length,1,'Expected one existing branch webhook');
  const hook=candidates[0],webhookURL=new URL(hook.url);
  const target=path=>{const u=new URL(webhookURL.href);u.pathname=path;return u;};
  async function call(path,{method='GET',body,headers={}}={}) {
   const response=await fetch(target(path),{method,redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
   let data;try{data=await response.json();}catch{data={};}
   return {status:response.status,data};
  }
  const testHeaders={'x-checkout-test-token':process.env.CHECKOUT_TEST_TOKEN};
  step='preview_access';
  const config=await call('/api/checkout-config');
  assert.equal(config.status,200);assert.equal(config.data.enabled,true);assert.equal(config.data.version,'sandbox-hardening-v1');assert.equal(config.data.realPaymentsEnabled,false);
  results.checks.push('preview_access_and_production_disabled');
  step='sync_webhook_authentication';
  // Preserve existing URL and its already-authorized protection bypass.
  const events=[...new Set([...(hook.events||[]),'PAYMENT_CREATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_REFUNDED','PAYMENT_DELETED'])];
  await asaas('/webhooks/'+encodeURIComponent(hook.id),{method:'PUT',body:{authToken:process.env.ASAAS_WEBHOOK_TOKEN,events,enabled:true,interrupted:false}});
  results.checks.push('existing_webhook_token_synchronized_without_disabling_protection');
  step='reject_unauthorized';
  assert.equal((await call('/api/asaas-webhook',{method:'POST',body:{}})).status,401);
  assert.equal((await call('/api/checkout-sandbox',{method:'POST',body:{}})).status,401);
  assert.equal((await call('/api/checkout-sandbox',{method:'POST',body:{},headers:testHeaders})).status,400);
  results.checks.push('missing_authentication_and_invalid_input_rejected');
  for(const plan of ['entry','cash']) {
   const key=run+'_'+plan;
   const body={fullName:'Homologacao Ficticia '+run,email:'fbp-'+run+'-'+plan+'@example.com',phone:'11900000000',cpf:'52998224725',city:'Cidade Teste',state:'BA',privacy:true,packageType:plan==='entry'?3:1,quantity:1,paymentPlan:plan};
   step=plan+'_checkout';
   const request={method:'POST',body,headers:{...testHeaders,'Idempotency-Key':key}};
   const first=await call('/api/checkout-sandbox',request);assert.equal(first.status,201);
   const reference=first.data.reference;assert.equal(first.data.amount,plan==='entry'?100:900);assert.equal(first.data.environment,'sandbox');
   const replays=await Promise.all([call('/api/checkout-sandbox',request),call('/api/checkout-sandbox',request)]);
   for(const replay of replays){assert.equal(replay.status,200);assert.equal(replay.data.reference,reference);}
   const alternate=await call('/api/checkout-sandbox',{...request,headers:{...testHeaders,'Idempotency-Key':key+'_same_cart'}});
   assert.equal(alternate.status,200);assert.equal(alternate.data.reference,reference);
   const conflict=await call('/api/checkout-sandbox',{...request,body:{...body,quantity:2}});assert.equal(conflict.status,409);
   const charges=await asaas('/payments?externalReference='+encodeURIComponent(reference)+'&limit=100');
   assert.equal(charges.data.length,1);assert.equal(charges.totalCount,1);
   const paymentId=charges.data[0].id;
   const before=await call('/api/order-status-sandbox',{method:'POST',body:{reference},headers:testHeaders});assert.equal(before.data.status,'awaiting_payment');
   // A forged webhook's status/value cannot settle a pending payment: the API is authoritative.
   step=plan+'_forged_payload';
   const forged=await call('/api/asaas-webhook',{method:'POST',headers:{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN},body:{id:'test_forged_'+key,event:'PAYMENT_RECEIVED',payment:{id:paymentId,status:'RECEIVED',value:0.01}}});
   assert.equal(forged.status,200);
   const stillPending=await call('/api/order-status-sandbox',{method:'POST',body:{reference},headers:testHeaders});assert.equal(stillPending.data.status,'awaiting_payment');
   step=plan+'_confirm_sandbox_payment';
   const confirmedAt=new Date().toISOString();
   await asaas('/sandbox/payment/'+encodeURIComponent(paymentId)+'/confirm',{method:'POST',body:{}});
   step=plan+'_automatic_webhook';
   let order,eventsSeen=[];
   for(let i=0;i<24;i++) {
    const rows=await db('orders?public_reference=eq.'+reference+'&select=id,status,total_cents,initial_due_cents,remaining_balance_cents,reconciliation_required');order=rows[0];
    eventsSeen=await db('asaas_webhook_events?asaas_payment_id=eq.'+encodeURIComponent(paymentId)+'&processed_at=not.is.null&select=asaas_event_id,event_type,received_at,processed_at,processing_error');
    if(order?.status===(plan==='entry'?'entry_paid':'paid')&&eventsSeen.some(e=>e.asaas_event_id.startsWith('evt_')&&['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(e.event_type)&&e.received_at>=confirmedAt))break;
    await new Promise(resolve=>setTimeout(resolve,2000));
   }
   assert.equal(order?.status,plan==='entry'?'entry_paid':'paid');assert.equal(order.reconciliation_required,false);assert.equal(order.remaining_balance_cents,plan==='entry'?190000:0);
   const vendorEvent=eventsSeen.find(e=>e.asaas_event_id.startsWith('evt_')&&['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(e.event_type)&&e.received_at>=confirmedAt);assert(vendorEvent,'No automatic Asaas payment event');assert.equal(vendorEvent.processing_error,null);
   // This request replays a delivered event; it does not perform manual reconciliation.
   step=plan+'_duplicate_webhook';
   const duplicate=await call('/api/asaas-webhook',{method:'POST',headers:{'asaas-access-token':process.env.ASAAS_WEBHOOK_TOKEN},body:{id:vendorEvent.asaas_event_id,event:vendorEvent.event_type,payment:{id:paymentId}}});
   assert.equal(duplicate.status,200);assert.equal(duplicate.data.duplicate,true);
   const paymentRows=await db('payments?asaas_payment_id=eq.'+paymentId+'&select=status,amount_cents');assert.equal(paymentRows.length,1);
   const after=await call('/api/order-status-sandbox',{method:'POST',body:{reference},headers:testHeaders});assert.equal(after.data.status,order.status);
   results.cases.push({plan,reference,paymentId,amountCents:paymentRows[0].amount_cents,paymentStatus:paymentRows[0].status,orderStatus:order.status,remainingBalanceCents:order.remaining_balance_cents,automaticEvent:vendorEvent,checkoutReplays:3,chargeCount:1,duplicateWebhookHTTP:duplicate.status,statusEndpointHTTP:after.status});
   console.log('SANDBOX_CASE_PASSED',JSON.stringify(results.cases.at(-1)));
  }
  results.checks.push('automatic_confirmation_entry_and_cash','checkout_idempotency_and_conflict','forged_webhook_cannot_settle_pending_payment','duplicate_webhook_acknowledged','one_charge_per_order');
  await db('sandbox_verification_runs?run_id=eq.'+encodeURIComponent(run),{method:'PATCH',body:{status:'passed',results,finished_at:new Date().toISOString()},prefer:'return=minimal'});
  console.log('SANDBOX_HOMOLOGATION_PASSED',JSON.stringify({runId:run,checks:results.checks}));
 } catch {
  results.failedStep=step;
  await db('sandbox_verification_runs?run_id=eq.'+encodeURIComponent(run),{method:'PATCH',body:{status:'failed',results,finished_at:new Date().toISOString()},prefer:'return=minimal'});
  console.error('SANDBOX_HOMOLOGATION_FAILED',JSON.stringify({runId:run,step}));
  throw new Error('Sandbox verification failed at '+step+'; inspect sanitized audit results');
 }
}
