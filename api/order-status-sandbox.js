import { db } from './_lib/db.js';
import { safeEquals,sandboxReady } from './_lib/sandbox.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!sandboxReady()||!process.env.CHECKOUT_TEST_TOKEN)return res.status(503).json({error:'Sandbox Preview not configured'});
  if(!safeEquals(req.headers['x-checkout-test-token'],process.env.CHECKOUT_TEST_TOKEN))return res.status(401).json({error:'Unauthorized'});
  const reference=req.body?.reference;
  if(!/^FBP-[A-F0-9]{12}$/.test(reference||''))return res.status(400).json({error:'Invalid reference'});
  try {
    const orders=await db('orders?public_reference=eq.'+reference+'&select=status,remaining_balance_cents,reconciliation_required');
    if(orders.length!==1)return res.status(404).json({error:'Order not found'});
    return res.status(200).json({reference,...orders[0],environment:'sandbox'});
  }catch{return res.status(503).json({error:'Status temporarily unavailable'});}
}
