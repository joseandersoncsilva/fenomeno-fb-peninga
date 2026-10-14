import { productionDb as db, assertProductionStatusAllowed } from './_lib/production-guard.js';

import { verifyProductionStatusAccess as verifyStatusAccess } from './_lib/production-status-access.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  try{assertProductionStatusAllowed();}catch{return res.status(503).json({error:'Real payments disabled'});}
  const reference=req.body?.reference;
  if(!/^FBP-[A-F0-9]{12}$/.test(reference||''))return res.status(400).json({error:'Invalid reference'});
  if(!verifyStatusAccess(reference,req.body?.statusAccess))return res.status(401).json({error:'Invalid or expired order access'});
  try {
    const orders=await db('orders?public_reference=eq.'+reference+'&select=status,remaining_balance_cents,reconciliation_required,initial_due_cents,created_at');
    if(orders.length!==1)return res.status(404).json({error:'Order not found'});
    return res.status(200).json({reference,...orders[0],environment:'production'});
  }catch{return res.status(503).json({error:'Status temporarily unavailable'});}
}
