import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const url='https://nnysmymyvsydikdwlprg.supabase.co';
const cookieName='__Host-fbp_sales';
const lifetime=3600;
const digest=s=>createHash('sha256').update(s).digest();
const equal=(a,b)=>timingSafeEqual(digest(a),digest(b));
const sign=(value,secret)=>createHmac('sha256',secret).update('sales-session:'+value).digest('hex');
export function session(secret,now=Date.now()) {
 const payload=Math.floor(now/1000)+lifetime+'.'+randomBytes(24).toString('hex');
 return payload+'.'+sign(payload,secret);
}
export function validSession(token,secret,now=Date.now()) {
 if(typeof token!=='string'||!/^\d{10}\.[a-f0-9]{48}\.[a-f0-9]{64}$/.test(token))return false;
 const [expires,nonce,signature]=token.split('.');
 return Number(expires)>now/1000&&Number(expires)<=now/1000+lifetime&&equal(signature,sign(expires+'.'+nonce,secret));
}
async function database(path,body) {
 const response=await fetch(url+'/rest/v1/'+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(10000),
 headers:{apikey:process.env.FBP_PROD_SUPABASE_SECRET_KEY,Authorization:'Bearer '+process.env.FBP_PROD_SUPABASE_SECRET_KEY,'Content-Type':'application/json'},
 ...(body?{body:JSON.stringify(body)}:{})});
 if(!response.ok)throw Error('Database unavailable');
 return response.json();
}
export function summarize(orders) {
 const metrics={orders:orders.length,entryReceived:0,receivedCents:0,contractedCents:0,pendingPayments:0,reviewOrders:0};
 for(const order of orders){
  metrics.contractedCents+=order.total_cents;
  let received=false;
  for(const payment of order.payments||[]){
   // CONFIRMED is not yet cash received. Refunds/chargebacks are excluded, not estimated.
   if(['RECEIVED','RECEIVED_IN_CASH'].includes(payment.status)){metrics.receivedCents+=payment.amount_cents;received=true;}
   if(['PENDING','OVERDUE','CONFIRMED'].includes(payment.status))metrics.pendingPayments++;
  }
  if(received&&order.payment_plan==='entry')metrics.entryReceived++;
  if(order.reconciliation_required||['payment_review','partially_refunded'].includes(order.status))metrics.reviewOrders++;
 }
 return metrics;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Vercel-CDN-Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Vary','Cookie');
 const secret=process.env.FBP_SALES_ACCESS_SECRET;
 if(process.env.VERCEL_ENV!=='production'||typeof secret!=='string'||secret.length<32||
  !/^https:\/\/[^/]+$/.test(process.env.FBP_CHECKOUT_ORIGIN||'')||process.env.FBP_PROD_SUPABASE_URL!==url||!process.env.FBP_PROD_SUPABASE_SECRET_KEY) {
  console.warn('Sales dashboard configuration incomplete',JSON.stringify({
    production:process.env.VERCEL_ENV==='production',
    accessSecretLongEnough:typeof secret==='string'&&secret.length>=32,
    validOrigin:/^https:\/\/[^/]+$/.test(process.env.FBP_CHECKOUT_ORIGIN||''),
    databaseUrlMatches:process.env.FBP_PROD_SUPABASE_URL===url,
    databaseKeyPresent:Boolean(process.env.FBP_PROD_SUPABASE_SECRET_KEY)
  }));
  return res.status(503).json({error:'Painel indisponível.'});
 }
 const action=req.query?.action||'data';
 const method=action==='data'?'GET':'POST';
 if(!['data','login','logout'].includes(action)||req.method!==method)return res.status(405).json({error:'Método não permitido.'});
 if(req.method==='POST'&&req.headers.origin!==process.env.FBP_CHECKOUT_ORIGIN)
  return res.status(403).json({error:'Origem não permitida.'});
 try{
  if(action==='login'){
   const ip=req.headers['x-vercel-forwarded-for'];
   if(typeof ip!=='string'||ip.length>100)return res.status(503).json({error:'Acesso indisponível.'});
   const hash=createHmac('sha256',secret).update('sales-login:'+ip).digest('hex');
   // Separate namespace from checkout, shared persistent limit across serverless instances.
   const limit=await database('rpc/consume_production_checkout_limit',{p_ip:hash,p_buyer:hash});
   if(!limit.allowed){res.setHeader('Retry-After','900');return res.status(429).json({error:'Muitas tentativas. Aguarde 15 minutos.'});}
   if(typeof req.body?.secret!=='string'||req.body.secret.length>256||!equal(req.body.secret,secret))return res.status(401).json({error:'Acesso não autorizado.'});
   res.setHeader('Set-Cookie',`${cookieName}=${session(secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lifetime}`);
   return res.status(200).json({ok:true});
  }
  if(action==='logout'){
   res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
   return res.status(200).json({ok:true});
  }
  const token=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  if(!validSession(token,secret))return res.status(401).json({error:'Sessão expirada. Entre novamente.'});
  const orders=[];
  // All metrics paginate explicitly. Never silently return Supabase's first 1,000 rows.
  for(let offset=0;offset<=10000;){
   const page=await database('orders?select=id,total_cents,payment_plan,status,reconciliation_required,payments(status,amount_cents)&order=created_at.desc,id.desc&limit=500&offset='+offset);
   if(!Array.isArray(page))throw Error('Invalid response');
   if(page.length===0)break;
   orders.push(...page);offset+=page.length;
   if(orders.length>10000)throw Error('Dashboard capacity exceeded');
  }
  const recent=await database('orders?select=public_reference,created_at,offer_type,package_quantity,total_cents,initial_due_cents,status,customers(full_name,phone)&order=created_at.desc,id.desc&limit=50');
  const rows=recent.map(o=>({reference:o.public_reference,createdAt:o.created_at,buyer:o.customers?.full_name||'Não informado',phone:o.customers?.phone||'Não informado',
   package:o.offer_type,quantity:o.package_quantity,totalCents:o.total_cents,initialCents:o.initial_due_cents,status:o.status}));
  return res.status(200).json({metrics:summarize(orders),orders:rows,expiresAt:Number(token.split('.')[0])*1000,updatedAt:new Date().toISOString()});
 }catch{return res.status(503).json({error:'Não foi possível atualizar. Tente novamente.'});}
}
