import { productionConfiguration } from './_lib/production-guard.js';
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const p=productionConfiguration();
 return res.status(200).json({
   environment:process.env.VERCEL_ENV==='production'?'production':'non-production',
   paymentsEnabled:p.runningInProduction&&Object.values(p).every(Boolean),
   checks:{
    productionDatabase:p.databaseConfigured,
    asaasAccountKey:p.asaasConfigured,
    webhookAuthentication:p.webhookConfigured,
    orderAccessSecret:p.statusSecretConfigured,
    explicitRelease:p.explicitlyEnabled
   }
 });
}
