import { timingSafeEqual } from 'node:crypto';
import { db } from './_lib/db.js';

const eq=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const digits=v=>String(v||'').replace(/\D/g,'');
function cpfValid(value){const d=digits(value);if(d.length!==11||/^(\d)\1+$/.test(d))return false;for(let len=9;len<=10;len++){let sum=0;for(let i=0;i<len;i++)sum+=Number(d[i])*(len+1-i);let check=sum*10%11;if(check===10)check=0;if(check!==Number(d[len]))return false;}return true;}
async function asaas(path,body){
 const result=await fetch('https://api-sandbox.asaas.com/v3'+path,{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'FBPeningaCheckout/0.1 (sandbox)','access_token':process.env.ASAAS_SANDBOX_API_KEY},body:JSON.stringify(body)});
 if(!result.ok){
   let codes=[];
   try {
     const payload=await result.json();
     codes=Array.isArray(payload?.errors)?payload.errors.map(e=>String(e.code||'unknown').slice(0,48)).slice(0,5):[];
   }catch{}
   // Do not log CPF, customer details, access tokens or Asaas raw error descriptions.
   console.error('Asaas sandbox validation',JSON.stringify({endpoint:path,httpStatus:result.status,errorCodes:codes}));
   throw new Error('Asaas sandbox error '+result.status);
 }
 return result.json();
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 // A backend-only rehearsal, not a publicly accessible checkout.
 if(process.env.ASAAS_ENV!=='sandbox'||!process.env.ASAAS_SANDBOX_API_KEY||!process.env.SUPABASE_SECRET_KEY||!process.env.CHECKOUT_TEST_TOKEN)
  return res.status(503).json({error:'Sandbox not configured'});
 if(!eq(req.headers['x-checkout-test-token'],process.env.CHECKOUT_TEST_TOKEN))return res.status(401).json({error:'Unauthorized'});
 const {fullName,email,phone,cpf,packageType,quantity,paymentPlan}=req.body||{};
 const q=Number(quantity), pkg=Number(packageType);
 if(![1,3].includes(pkg)||!Number.isInteger(q)||q<1||q>100||!['entry','cash'].includes(paymentPlan)
  ||typeof fullName!=='string'||fullName.trim().length<3||fullName.length>120
  ||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>160
  ||!cpfValid(cpf)||![10,11].includes(digits(phone).length))
  return res.status(400).json({error:'Dados inválidos'});
 const totalCents=q*(pkg===3?200000:100000)*(paymentPlan==='cash'?9:10)/10;
 const chargeCents=paymentPlan==='cash'?totalCents:q*10000;
 const remaining=totalCents-chargeCents;
 try{
   const customers=await db('customers?select=id,asaas_customer_id',{method:'POST',body:{full_name:fullName.trim(),email:email.trim().toLowerCase(),phone:digits(phone),tax_id:digits(cpf)},prefer:'return=representation'});
   const customer=customers[0];
   const orders=await db('orders?select=id,public_reference',{method:'POST',body:{customer_id:customer.id,offer_type:pkg===3?'package_3':'single',package_quantity:q,coverage_quantity:q*pkg,payment_plan:paymentPlan,total_cents:totalCents,initial_due_cents:chargeCents,remaining_balance_cents:remaining},prefer:'return=representation'});
   const order=orders[0];
   const payer=await asaas('/customers',{name:fullName.trim(),email:email.trim().toLowerCase(),cpfCnpj:digits(cpf),externalReference:customer.id,notificationDisabled:true});
   await db('customers?id=eq.'+customer.id,{method:'PATCH',body:{asaas_customer_id:payer.id},prefer:'return=minimal'});
   const due=new Date(Date.now()+5*86400000).toISOString().slice(0,10);
   const payment=await asaas('/payments',{customer:payer.id,billingType:'BOLETO',value:chargeCents/100,dueDate:due,description:'FB Peninga - '+order.public_reference+' - '+(paymentPlan==='entry'?'entrada':'a vista'),externalReference:order.public_reference});
   await db('payments',{method:'POST',body:{order_id:order.id,asaas_payment_id:payment.id,billing_type:'BOLETO',amount_cents:chargeCents,status:payment.status||'PENDING',payment_url:payment.invoiceUrl||null,due_date:due},prefer:'return=minimal'});
   await db('orders?id=eq.'+order.id,{method:'PATCH',body:{status:'awaiting_payment'},prefer:'return=minimal'});
   return res.status(201).json({reference:order.public_reference,invoiceUrl:payment.invoiceUrl,amount:chargeCents/100,environment:'sandbox',notice:'Teste sem movimentacao real'});
 }catch(err){console.error('Checkout sandbox error',err.message);return res.status(502).json({error:'Não foi possível gerar a cobrança de teste. Consulte o suporte.'});}
}
