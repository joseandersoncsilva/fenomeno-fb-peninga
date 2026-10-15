import { timingSafeEqual } from 'node:crypto';
import { productionDb as db,productionAsaas as asaas,assertProductionIntegrationAllowed } from './_lib/production-guard.js';

function authorized(provided, expected) {
 if(typeof provided!=='string'||typeof expected!=='string'||expected.length<32)return false;
 const a=Buffer.from(provided),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
 try{assertProductionIntegrationAllowed();}catch{return res.status(503).json({error:'Production disabled'});}
 if(!authorized(req.headers['x-reconciliation-secret'],process.env.FBP_PROD_RECONCILE_SECRET))
   return res.status(401).json({error:'Unauthorized'});
 const reference=req.method==='GET'?req.query?.reference:req.body?.reference;
 if(!/^FBP-[A-F0-9]{12}$/.test(reference||''))return res.status(400).json({error:'Invalid order reference'});
 try {
  // GET is strictly read-only. Old deployments reject it with 405, so preparation
  // cannot accidentally invoke the legacy POST reconciliation write path.
  if(req.method==='GET') {
   const paymentId=req.query?.paymentId;
   if(!/^pay_[A-Za-z0-9]+$/.test(paymentId||''))return res.status(400).json({error:'Invalid payment ID'});
   const rows=await db('orders?public_reference=eq.'+reference+'&select=id,customer_id,initial_due_cents,total_cents,status');
   if(rows.length!==1)return res.status(404).json({error:'Order not found'});
   const order=rows[0];
   const payments=await db('payments?asaas_payment_id=eq.'+paymentId+'&select=order_id,amount_cents,billing_type,status');
   const customers=await db('customers?id=eq.'+order.customer_id+'&select=asaas_customer_id');
   const remote=await asaas('/payments/'+encodeURIComponent(paymentId));
   const checks={identity:remote.id===paymentId,reference:remote.externalReference===reference,
    ownership:payments.length===1&&payments[0].order_id===order.id,
    customer:customers.length===1&&Boolean(customers[0].asaas_customer_id)&&remote.customer===customers[0].asaas_customer_id,
    amount:Number(remote.value)*100===order.initial_due_cents&&payments.length===1&&payments[0].amount_cents===order.initial_due_cents,
    billingType:remote.billingType==='BOLETO'||remote.billingType==='PIX'&&payments.length===1&&['BOLETO','PIX'].includes(payments[0].billing_type),
    oneTime:remote.installment==null&&remote.subscription==null,notDeleted:remote.deleted!==true};
   return res.status(200).json({readOnly:true,reference,paymentId,checks,verified:Object.values(checks).every(Boolean),
    remoteStatus:['PENDING','CONFIRMED','RECEIVED','RECEIVED_IN_CASH','OVERDUE','REFUNDED','PARTIALLY_REFUNDED'].includes(remote.status)?remote.status:'OTHER',
    remoteBillingType:['BOLETO','PIX'].includes(remote.billingType)?remote.billingType:'OTHER'});
  }
  const orders=await db('orders?public_reference=eq.'+reference+'&select=id');
  if(orders.length!==1)return res.status(404).json({error:'Order not found'});
  const found=await asaas('/payments?externalReference='+encodeURIComponent(reference)+'&limit=2');
  if(found.data?.length!==1)return res.status(409).json({error:'Payment missing or ambiguous; manual review required'});
  const remote=await asaas('/payments/'+encodeURIComponent(found.data[0].id));
  if(remote.id!==found.data[0].id||remote.externalReference!==reference)throw new Error('Identity mismatch');
  const result=await db('rpc/apply_production_payment',{method:'POST',body:{p_remote:remote}});
  if(result.ignored||result.reference!==reference)throw new Error('Order mismatch');
  if(result.reconciliationRequired)return res.status(409).json({error:'Manual financial review required'});
  const response={reference,invoiceUrl:remote.invoiceUrl,amount:Number(remote.value),dueDate:remote.dueDate||null,environment:'production',orderStatus:result.orderStatus};
  await db('checkout_requests?order_id=eq.'+orders[0].id,{method:'PATCH',body:{status:'completed',response,updated_at:new Date().toISOString()},prefer:'return=minimal'});
  return res.status(200).json({reference:result.reference,orderStatus:result.orderStatus,paymentStatus:result.paymentStatus,remainingBalanceCents:result.remainingBalanceCents});
 }catch(e){
  console.error('Production reconciliation requires attention',String(e.message).slice(0,100));
  return res.status(503).json({error:'Reconciliation pending'});
 }
}
