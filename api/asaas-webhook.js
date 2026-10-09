import { timingSafeEqual } from 'node:crypto';
import { db } from './_lib/db.js';
function sameSecret(a,b) {
 if (typeof a !== 'string' || typeof b !== 'string') return false;
 const x=Buffer.from(a), y=Buffer.from(b);
 return x.length === y.length && timingSafeEqual(x,y);
}
export default async function handler(req,res) {
 if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
 const expected=process.env.ASAAS_WEBHOOK_TOKEN;
 if(!expected || !sameSecret(req.headers['asaas-access-token'],expected))
   return res.status(401).json({error:'Unauthorized'});
 const e=req.body;
 if(!e || typeof e.id!=='string' || typeof e.event!=='string' || !e.payment?.id)
   return res.status(400).json({error:'Invalid event'});
 try {
   // Persist raw event before acknowledgement. An independent worker should reconcile
   // payment status by fetching current Asaas state; never trust client-side paid flags.
   const record={asaas_event_id:e.id,event_type:e.event,asaas_payment_id:e.payment.id,payload:e};
   await db('asaas_webhook_events?on_conflict=asaas_event_id',{
     method:'POST',body:record,prefer:'resolution=ignore-duplicates,return=minimal'
   });
   return res.status(200).json({received:true});
 } catch(err) {
   console.error('Webhook persistence error',err.message);
   return res.status(500).json({error:'Retry later'});
 }
}
