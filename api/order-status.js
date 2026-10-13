import { productionConfiguration } from './_lib/production-guard.js';
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const state=productionConfiguration();
 if(!state.runningInProduction||!state.explicitlyEnabled)return res.status(503).json({error:'Production status unavailable'});
 return res.status(503).json({error:'Production status service awaiting final authorization'});
}