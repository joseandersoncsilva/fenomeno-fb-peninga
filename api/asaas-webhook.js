import { timingSafeEqual } from 'node:crypto';
import { db } from './_lib/db.js';

function equals(a,b) {
 if(typeof a!=='string'||typeof b!=='string') return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 const token=process.env.ASAAS_WEBHOOK_TOKEN;
 if(!token||!equals(req.headers['asaas-access-token'],token)) return res.status(401).json({error:'Unauthorized'});
 const event=req.body;
 if(!event||typeof event.id!=='string'||typeof event.event!=='string'||typeof event.payment?.id!=='string')
   return res.status(400).json({error:'Invalid event'});
 if(process.env.ASAAS_ENV!=='sandbox'||!process.env.ASAAS_SANDBOX_API_KEY)
   return res.status(503).json({error:'Sandbox not configured'});
 const paymentId=event.payment.id;
 try {
   await db('asaas_webhook_events?on_conflict=asaas_event_id',{method:'POST',body:{
      asaas_event_id:event.id,event_type:event.event,asaas_payment_id:paymentId,payload:event
   },prefer:'resolution=ignore-duplicates,return=minimal'});
   const local=await db('payments?asaas_payment_id=eq.'+encodeURIComponent(paymentId)+'&select=id,order_id,amount_cents');
   if(local.length!==1) {
      // Stored for later reconciliation (webhook may arrive before local payment insert).
      console.warn('Webhook event stored; local payment not yet found',event.event);
      return res.status(200).json({received:true,queued:true});
   }
   const response=await fetch('https://api-sandbox.asaas.com/v3/payments/'+encodeURIComponent(paymentId),{
     headers:{access_token:process.env.ASAAS_SANDBOX_API_KEY,'User-Agent':'FBPeningaCheckout/0.1 (sandbox)'}
   });
   if(!response.ok) throw new Error('Asaas status lookup '+response.status);
   const remote=await response.json();
   if(remote.id!==paymentId||!Number.isFinite(Number(remote.value))||Math.round(Number(remote.value)*100)!==local[0].amount_cents)
      throw new Error('Asaas payment identity or value mismatch');
   const orderRows=await db('orders?id=eq.'+local[0].order_id+'&select=id,status,payment_plan,total_cents');
   if(orderRows.length!==1) throw new Error('Payment order not found');
   const order=orderRows[0];
   const paid=['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(remote.status);
   await db('payments?id=eq.'+local[0].id,{method:'PATCH',body:{
      status:remote.status,
      ...(paid?{paid_at:remote.paymentDate||new Date().toISOString()}: {})
   },prefer:'return=minimal'});
   let newStatus=null;
   if(['REFUNDED','PARTIALLY_REFUNDED'].includes(remote.status)) newStatus=remote.status==='REFUNDED'?'refunded':'partially_refunded';
   else if(paid && !['refunded','partially_refunded'].includes(order.status))
      newStatus=order.payment_plan==='cash'&&local[0].amount_cents===order.total_cents?'paid':'entry_paid';
   else if(['DELETED'].includes(remote.status)&&['pending','awaiting_payment'].includes(order.status)) newStatus='cancelled';
   if(newStatus&&newStatus!==order.status) await db('orders?id=eq.'+order.id,{method:'PATCH',body:{status:newStatus},prefer:'return=minimal'});
   await db('asaas_webhook_events?asaas_event_id=eq.'+encodeURIComponent(event.id),{
      method:'PATCH',body:{processed_at:new Date().toISOString(),processing_error:null},prefer:'return=minimal'});
   return res.status(200).json({received:true});
 }catch(err) {
   console.error('Webhook reconciliation error',err.message);
   try {await db('asaas_webhook_events?asaas_event_id=eq.'+encodeURIComponent(event.id),{
       method:'PATCH',body:{processing_error:String(err.message).slice(0,160)},prefer:'return=minimal'
   });}catch{}
   return res.status(500).json({error:'Retry later'});
 }
}
