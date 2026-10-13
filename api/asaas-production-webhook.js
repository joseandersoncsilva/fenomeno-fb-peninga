import { productionConfiguration } from './_lib/production-guard.js';
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const state=productionConfiguration();
 // Do not accept or acknowledge real financial events before authentication and
 // reconciliation have been implemented and reviewed against the isolated database.
 if(!state.runningInProduction||!state.explicitlyEnabled)return res.status(503).json({error:'Production webhook not enabled'});
 return res.status(503).json({error:'Production webhook awaiting final authorization'});
}