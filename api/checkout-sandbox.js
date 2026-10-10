import { createHash } from 'node:crypto';
import { db } from './_lib/db.js';
import { issueStatusAccess } from './_lib/status-access.js';
import { asaas, invoiceURL, safeEquals, sandboxReady } from './_lib/sandbox.js';

const digits = v => String(v || '').replace(/\D/g, '');
export function cpfValid(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (let len=9; len<=10; len++) {
    let sum=0;
    for (let i=0; i<len; i++) sum += Number(d[i])*(len+1-i);
    let check=sum*10%11; if(check===10)check=0;
    if(check!==Number(d[len]))return false;
  }
  return true;
}
export function normalizedBuyer(body) {
  const { fullName,email,phone,cpf,packageType,quantity,paymentPlan,city,state,privacy }=body||{};
  const q=Number(quantity),pkg=Number(packageType);
  if(![1,3].includes(pkg)||!Number.isInteger(q)||q<1||q>100||!['entry','cash'].includes(paymentPlan)
    ||typeof fullName!=='string'||fullName.trim().length<3||fullName.length>120
    ||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>160
    ||!cpfValid(cpf)||![10,11].includes(digits(phone).length)
    ||typeof city!=='string'||city.trim().length<2||city.length>90
    ||!['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(state)
    ||privacy!==true) return null;
  return { fullName:fullName.trim(),email:email.trim().toLowerCase(),phone:digits(phone),cpf:digits(cpf),
    packageType:pkg,quantity:q,paymentPlan,city:city.trim(),state,privacy:true };
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!sandboxReady()||!process.env.CHECKOUT_TEST_TOKEN)return res.status(503).json({error:'Sandbox Preview not configured'});
  if(!safeEquals(req.headers['x-checkout-test-token'],process.env.CHECKOUT_TEST_TOKEN))return res.status(401).json({error:'Unauthorized'});
  const data=normalizedBuyer(req.body);
  const key=req.headers['idempotency-key'];
  if(!data||typeof key!=='string'||! /^[A-Za-z0-9_-]{16,100}$/.test(key))return res.status(400).json({error:'Dados ou chave de tentativa inválidos'});
  const hash=createHash('sha256').update(JSON.stringify(data)).digest('hex');
  let reservation;
  try {
    reservation=await db('rpc/reserve_sandbox_checkout',{method:'POST',body:{p_key:key,p_hash:hash,p_data:data}});
    if(reservation.conflict)return res.status(409).json({error:'A tentativa já existe com dados diferentes.'});
    if(!reservation.claimed) {
      if(reservation.request.status==='completed'&&reservation.request.response)
        return res.status(200).json({...reservation.request.response,statusAccess:issueStatusAccess(reservation.request.response.reference),replayed:true});
      return res.status(409).json({error:'Pedido em processamento ou conciliação. Não inicie outra compra.',code:'CHECKOUT_IN_PROGRESS'});
    }
    const {customer,order}=reservation;
    let payerId=customer.asaas_customer_id;
    if(!payerId) {
      const matches=await asaas('/customers?externalReference='+encodeURIComponent(customer.id)+'&limit=2');
      if(matches.data?.length>1)throw new Error('Ambiguous Sandbox customer');
      if(matches.data?.length===1)payerId=matches.data[0].id;
      else {
        const payer=await asaas('/customers',{method:'POST',body:{name:data.fullName,email:data.email,
          cpfCnpj:data.cpf,externalReference:customer.id,notificationDisabled:true}});
        payerId=payer.id;
      }
      await db('customers?id=eq.'+customer.id,{method:'PATCH',body:{asaas_customer_id:payerId},prefer:'return=minimal'});
    }
    // Reservation is claimed only once. Never retry this POST after a timeout.
    // An uncertain result is looked up by externalReference and otherwise requires review.
    let payment;
    const found=await asaas('/payments?externalReference='+encodeURIComponent(order.public_reference)+'&limit=2');
    if(found.data?.length>1)throw new Error('Multiple initial charges');
    if(found.data?.length===1)payment=found.data[0];
    else payment=await asaas('/payments',{method:'POST',body:{customer:payerId,billingType:'BOLETO',
      value:order.initial_due_cents/100,dueDate:new Date(Date.now()+5*86400000).toISOString().slice(0,10),
      description:'FB Peninga - '+order.public_reference+' - '+(data.paymentPlan==='entry'?'entrada':'a vista'),
      externalReference:order.public_reference}});
    const verified=await asaas('/payments/'+encodeURIComponent(payment.id));
    const url=invoiceURL(verified.invoiceUrl);
    const result=await db('rpc/apply_sandbox_payment',{method:'POST',body:{p_remote:verified}});
    const response={reference:order.public_reference,invoiceUrl:url,amount:order.initial_due_cents/100,
      environment:'sandbox',orderStatus:result.orderStatus,notice:'Teste sem movimentação real'};
    await db('checkout_requests?idempotency_key=eq.'+encodeURIComponent(key),{method:'PATCH',body:{
      status:'completed',response,updated_at:new Date().toISOString()},prefer:'return=minimal'});
    return res.status(201).json({...response,statusAccess:issueStatusAccess(order.public_reference)});
  } catch {
    // A remote success followed by a persistence failure must never create another charge.
    console.error('Checkout Sandbox requires reconciliation');
    if(reservation?.claimed)try {
      await db('checkout_requests?idempotency_key=eq.'+encodeURIComponent(key),{method:'PATCH',body:{status:'needs_review',updated_at:new Date().toISOString()},prefer:'return=minimal'});
      await db('orders?id=eq.'+reservation.order.id,{method:'PATCH',body:{reconciliation_required:true},prefer:'return=minimal'});
    } catch {}
    return res.status(502).json({error:'Pedido requer conciliação. Não gere outra cobrança; contate o suporte.',code:'RECONCILIATION_REQUIRED',...(reservation?.order?.public_reference?{reference:reservation.order.public_reference}:{})});
  }
}
