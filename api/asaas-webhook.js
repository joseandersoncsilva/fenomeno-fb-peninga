import { db } from './_lib/db.js';
import { asaas,safeEquals,sandboxReady } from './_lib/sandbox.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!sandboxReady()||!process.env.ASAAS_WEBHOOK_TOKEN)return res.status(503).json({error:'Sandbox webhook not configured'});
  if(!safeEquals(req.headers['asaas-access-token'],process.env.ASAAS_WEBHOOK_TOKEN))return res.status(401).json({error:'Unauthorized'});
  const event=req.body;
  if(!event||typeof event.id!=='string'||event.id.length>200||typeof event.event!=='string'
    ||!event.event.startsWith('PAYMENT_')||!/^pay_[A-Za-z0-9]+$/.test(event.payment?.id||''))
    return res.status(400).json({error:'Invalid payment event'});
  try {
    // Only store payment metadata. Names, CPF, contact data and invoice contents are unnecessary.
    await db('asaas_webhook_events?on_conflict=asaas_event_id',{method:'POST',body:{
      asaas_event_id:event.id,event_type:event.event,asaas_payment_id:event.payment.id,
      payload:{id:event.id,event:event.event,payment:{id:event.payment.id}}
    },prefer:'resolution=ignore-duplicates,return=minimal'});
    const logged=await db('asaas_webhook_events?asaas_event_id=eq.'+encodeURIComponent(event.id)+'&select=asaas_payment_id,event_type,processed_at');
    if(logged.length!==1||logged[0].asaas_payment_id!==event.payment.id||logged[0].event_type!==event.event)
      return res.status(409).json({error:'Event identity conflict'});
    if(logged[0].processed_at)return res.status(200).json({received:true,duplicate:true});
    const remote=await asaas('/payments/'+encodeURIComponent(event.payment.id));
    if(remote.id!==event.payment.id)throw new Error('Payment identity mismatch');
    const result=await db('rpc/apply_sandbox_payment',{method:'POST',body:{p_remote:remote,p_event_id:event.id}});
    console.info('Sandbox webhook processed',JSON.stringify({eventId:event.id,eventType:event.event,
      reference:result.reference||null,orderStatus:result.orderStatus||null,ignored:Boolean(result.ignored)}));
    return res.status(200).json({received:true,...(result.ignored?{ignored:true}:{})});
  } catch {
    console.error('Sandbox webhook reconciliation failed',JSON.stringify({eventId:event.id}));
    try {await db('asaas_webhook_events?asaas_event_id=eq.'+encodeURIComponent(event.id),{
      method:'PATCH',body:{processing_error:'reconciliation_failed_retry_required'},prefer:'return=minimal'});}catch{}
    return res.status(503).json({error:'Reconciliation pending; retry delivery'});
  }
}
