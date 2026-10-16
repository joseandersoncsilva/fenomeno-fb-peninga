// Reporting rules only: never persist commission or mutate financial records.
export const launchStart='2026-10-16T09:00:00Z';
const testReferences=new Set(['FBP-576152F21879','FBP-C8F89092C3DF','FBP-826F3F91967E']);
export function isOfficialOrder(order){
 return !testReferences.has(order.public_reference)&&Date.parse(order.created_at)>=Date.parse(launchStart);
}
export function commissionFor(order){
 if(!Number.isSafeInteger(order.total_cents)||order.total_cents<0)throw Error('Invalid contractual amount');
 const cents=Math.round(order.total_cents/20);
 if(!isOfficialOrder(order))return {cents,category:'history'};
 const payments=order.payments||[];
 if(order.reconciliation_required||['cancelled','refunded','partially_refunded','payment_review'].includes(order.status)||
  payments.some(p=>!['PENDING','OVERDUE','CONFIRMED','RECEIVED','RECEIVED_IN_CASH'].includes(p.status)))
  return {cents,category:'excluded'};
 if(order.status==='awaiting_payment'&&payments.some(p=>p.status==='PENDING')&&payments.every(p=>p.status==='PENDING'))
  return {cents,category:'potential'};
 if(order.status==='entry_paid')return {cents,category:'entryAwaitingFormalization'};
 // Even paid-in-full does not establish commercial formalization.
 return {cents,category:'awaitingCommercialIntegration'};
}
export function summarizeCommissions(orders){
 const result={potentialCents:0,entryAwaitingFormalizationCents:0,formalizedCents:null};
 for(const order of orders){const c=commissionFor(order);
  if(c.category==='potential')result.potentialCents+=c.cents;
  if(c.category==='entryAwaitingFormalization')result.entryAwaitingFormalizationCents+=c.cents;
 }
 return result;
}
