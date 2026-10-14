import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { productionDb } from './production-guard.js';

export async function protectCheckout(req,data) {
  const origin=process.env.FBP_CHECKOUT_ORIGIN;
  if(req.headers.origin!==origin)return {ok:false,status:403,error:'Origem inválida.'};
  // Vercel overwrites this header. Never trust the client-supplied X-Forwarded-For.
  const ip=req.headers['x-vercel-forwarded-for'];
  if(typeof ip!=='string'||!isIP(ip))return {ok:false,status:503,error:'Não foi possível validar a conexão.'};
  const hash=value=>createHmac('sha256',process.env.FBP_PROD_STATUS_SECRET).update('checkout-abuse:'+value).digest('hex');
  const limit=await productionDb('rpc/consume_production_checkout_limit',{method:'POST',body:{p_ip:hash(ip),p_buyer:hash(data.cpf)}});
  if(limit?.allowed!==true)return {ok:false,status:429,error:'Muitas tentativas. Aguarde 15 minutos ou contate o suporte.'};
  const token=req.body?.antiBotToken;
  if(typeof token!=='string'||!token.length||token.length>2048)return {ok:false,status:400,error:'Conclua a verificação de segurança.'};
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({secret:process.env.FBP_TURNSTILE_SECRET_KEY,response:token,remoteip:ip})
  });
  if(!response.ok)throw new Error('Bot verification unavailable');
  const proof=await response.json();
  if(proof.success!==true||proof.hostname!==new URL(origin).hostname||proof.action!=='checkout')
    return {ok:false,status:403,error:'Verificação expirada ou inválida. Tente novamente.'};
  return {ok:true};
}
