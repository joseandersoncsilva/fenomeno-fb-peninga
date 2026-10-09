import { timingSafeEqual } from 'node:crypto';
import { db } from './_lib/db.js';

function safeEq(a,b) {
 if(typeof a!=='string'||typeof b!=='string')return false;
 const x=Buffer.from(a),y=Buffer.from(b);
 return x.length===y.length&&timingSafeEqual(x,y);
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(process.env.ASAAS_ENV!=='sandbox'||!process.env.ASAAS_SANDBOX_API_KEY||!process.env.CHECKOUT_TEST_TOKEN)
   return res.status(503).json({error:'Sandbox not configured'});
 if(!safeEq(req.headers['x-checkout-test-token'],process.env.CHECKOUT_TEST_TOKEN))
   return res.status(401).json({error:'Unauthorized'});
 const id=req.body?.paymentId;
 if(typeof id!=='string'||!/^pay_[a-zA-Z0-9]+$/.test(id))
   return res.status(400).json({error:'Invalid payment ID'});
 try {
   const existing=await db('payments?asaas_payment_id=eq.'+encodeURIComponent(id)+'&select=id,order_id,amount_cents');
   if(existing.length!==1)return res.status(404).json({error:'Payment not found'});
   const payment=existing[0];
   const response=await fetch('https://api-sandbox.asaas.com/v3/payments/'+encodeURIComponent(id),{
     headers:{access_token:process.env.ASAAS_SANDBOX_API_KEY,'User-Agent':'FBPeningaCheckout/0.1 (sandbox)'}
   });
   if(!response.ok)throw new Error('Asaas query failed: '+response.status);
   const remote=await response.json();
   if(remote.id!==id||Math.round(Number(remote.value)*100)!==payment.amount_cents)
     throw new Error('Payment identity or amount mismatch');
   const settled=['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(remote.status);
   await db('payments?id=eq.'+payment.id,{method:'PATCH',body:{
      status:remote.status,paid_at:settled?(remote.paymentDate||new Date().toISOString()):null
   },prefer:'return=minimal'});
   const orders=await db('orders?id=eq.'+payment.order_id+'&select=id,payment_plan,initial_due_cents,total_cents,status');
   if(orders.length!==1)throw new Error('Order missing');
   const order=orders[0];
   if(settled) {
      const newStatus=order.payment_plan==='cash'&&payment.amount_cents===order.total_cents?'paid':'entry_paid';
      await db('orders?id=eq.'+order.id,{method:'PATCH',body:{status:newStatus},prefer:'return=minimal'});
   }
   return res.status(200).json({paymentStatus:remote.status,orderStatus:settled?(order.payment_plan==='cash'?'paid':'entry_paid'):order.status});
 }catch(e){
   console.error('Reconciliation failed',e.message);
   return res.status(502).json({error:'Unable to reconcile payment'});
 }
}
