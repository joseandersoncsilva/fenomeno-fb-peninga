// Preview-safe quote: no API credentials, no charging, no personal data.
const json=(res,status,data)=>{res.status(status).setHeader('Content-Type','application/json; charset=utf-8').setHeader('Cache-Control','no-store').end(JSON.stringify(data));};
export default function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
 let body=req.body;
 if(typeof body==='string'){try{body=JSON.parse(body)}catch{return json(res,400,{error:'INVALID_JSON'});}}
 if(!body||typeof body!=='object')return json(res,400,{error:'INVALID_BODY'});
 const {packageSize,quantity,paymentMethod}=body;
 if(![1,3].includes(packageSize)||!Number.isInteger(quantity)||quantity<1||quantity>500||!['installments','cash'].includes(paymentMethod))return json(res,400,{error:'INVALID_SELECTION'});
 const fullCents=(packageSize===3?200000:100000)*quantity;
 const contractCents=paymentMethod==='cash'?Math.round(fullCents*.9):fullCents;
 const initialCents=paymentMethod==='cash'?contractCents:quantity*10000;
 return json(res,200,{packageSize,quantity,covers:packageSize*quantity,paymentMethod,contractCents,initialCents,balanceCents:contractCents-initialCents,currency:'BRL',chargeEnabled:false});
}
