import { db } from './_lib/db.js';
import { asaas,safeEquals,sandboxReady,invoiceURL } from './_lib/sandbox.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!sandboxReady()||!process.env.CHECKOUT_TEST_TOKEN)return res.status(503).json({error:'Sandbox Preview not configured'});
  if(!safeEquals(req.headers['x-checkout-test-token'],process.env.CHECKOUT_TEST_TOKEN))return res.status(401).json({error:'Unauthorized'});
  const {paymentId,reference}=req.body||{};
  if(!/^pay_[A-Za-z0-9]+$/.test(paymentId||'')&&!/^FBP-[A-F0-9]{12}$/.test(reference||''))return res.status(400).json({error:'Invalid payment or order ID'});
  try {
    let id=paymentId;
    if(!id) {
      const orders=await db('orders?public_reference=eq.'+reference+'&select=id');
      if(orders.length!==1)return res.status(404).json({error:'Order not found'});
      const found=await asaas('/payments?externalReference='+encodeURIComponent(reference)+'&limit=2');
      if(found.data?.length!==1)return res.status(409).json({error:'Missing or ambiguous charge; manual review required'});
      id=found.data[0].id;
    }
    const remote=await asaas('/payments/'+encodeURIComponent(id));
    if(remote.id!==id)throw new Error('Invalid remote identity');
    const result=await db('rpc/apply_sandbox_payment',{method:'POST',body:{p_remote:remote}});
    if(result.ignored)return res.status(404).json({error:'Checkout payment not found'});
    // Repair an uncertain checkout only after a verified remote identity and amount.
    const response={reference:result.reference,invoiceUrl:invoiceURL(remote.invoiceUrl),amount:Number(remote.value),environment:'sandbox',orderStatus:result.orderStatus};
    const orders=await db('orders?public_reference=eq.'+result.reference+'&select=id');
    await db('checkout_requests?order_id=eq.'+orders[0].id,{method:'PATCH',body:{status:'completed',response,updated_at:new Date().toISOString()},prefer:'return=minimal'});
    return res.status(200).json(result);
  }catch {
    console.error('Sandbox reconciliation requires review');
    return res.status(502).json({error:'Unable to reconcile payment'});
  }
}
