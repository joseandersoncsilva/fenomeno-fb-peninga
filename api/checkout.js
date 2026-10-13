import { productionDb,assertProductionPaymentsAllowed } from './_lib/production-guard.js';
import { createHash } from 'node:crypto';
import { normalizedBuyer } from './checkout-sandbox.js';
import { issueStatusAccess } from './_lib/status-access.js';

async function requestAsaas(path,{method='GET',body}={}) {
 assertProductionPaymentsAllowed();
 const response=await fetch('https://api.asaas.com/v3'+path,{
  method,signal:AbortSignal.timeout(12000),redirect:'error',
  headers:{'Content-Type':'application/json',access_token:process.env.ASAAS_API_KEY,'User-Agent':'FBPeningaCheckout/1.0'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!response.ok)throw new Error('Production Asaas HTTP '+response.status);
 return response.json();
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{assertProductionPaymentsAllowed();}catch{return res.status(503).json({error:'Real payments disabled'});}
 // No public production checkout until full launch authorization, anti-abuse and monitoring review.
 return res.status(503).json({error:'Checkout production pending final release'});
}
