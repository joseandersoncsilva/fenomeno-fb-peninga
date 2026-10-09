// Shared Asaas integration, server-side only. Never import this from browser code.
const BASES={sandbox:'https://api-sandbox.asaas.com/v3',production:'https://api.asaas.com/v3'};
export function quote(input){
 const packageSize=Number(input?.packageSize),quantity=Number(input?.quantity),paymentMethod=input?.paymentMethod;
 if(![1,3].includes(packageSize)||!Number.isInteger(quantity)||quantity<1||quantity>500||!['installments','cash'].includes(paymentMethod))throw new Error('INVALID_SELECTION');
 const fullCents=(packageSize===3?200000:100000)*quantity;
 const contractCents=paymentMethod==='cash'?Math.round(fullCents*.9):fullCents;
 const initialCents=paymentMethod==='cash'?contractCents:quantity*10000;
 return {packageSize,quantity,covers:packageSize*quantity,paymentMethod,contractCents,initialCents,balanceCents:contractCents-initialCents};
}
export async function asaasRequest(path,{method='GET',body}={}){
 const mode=process.env.ASAAS_MODE;
 if(!['sandbox','production'].includes(mode))throw new Error('ASAAS_MODE_NOT_CONFIGURED');
 const key=process.env.ASAAS_API_KEY;
 if(!key)throw new Error('ASAAS_KEY_NOT_CONFIGURED');
 const response=await fetch(BASES[mode]+path,{method,headers:{'access_token':key,'accept':'application/json','content-type':'application/json','User-Agent':'FenomenoFBPeninga/1.0'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const err=new Error('ASAAS_UPSTREAM_ERROR');err.status=response.status;throw err;}
 return data;
}
// For future use only AFTER durable order storage and idempotency are in place.
export const customerPayload=person=>({name:person.name,cpfCnpj:person.cpfCnpj,email:person.email,mobilePhone:person.mobilePhone});
export function firstBoletoPayload({customerId,orderId,quote:orderQuote,dueDate}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))throw new Error('INVALID_DUE_DATE');
 return {customer:customerId,billingType:'BOLETO',value:orderQuote.initialCents/100,dueDate,externalReference:orderId,description:`FB Peninga: ${orderQuote.quantity} pacote(s) de ${orderQuote.packageSize} cobertura(s) - entrada`};
}
