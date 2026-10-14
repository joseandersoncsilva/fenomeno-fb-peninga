import { sandboxReady } from './_lib/sandbox.js';
import { productionConfiguration } from './_lib/production-guard.js';
export default function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const prod=productionConfiguration();
 const realPaymentsEnabled=Object.values(prod).every(Boolean);
 if(realPaymentsEnabled) return res.status(200).json({enabled:true,environment:'production',realPaymentsEnabled:true,turnstileSiteKey:process.env.FBP_TURNSTILE_SITE_KEY,version:'prod-release-gated-v2'});
 const sandboxEnabled=Boolean(sandboxReady()&&process.env.CHECKOUT_TEST_TOKEN);
 return res.status(200).json({enabled:sandboxEnabled,environment:prod.runningInProduction?'production':sandboxEnabled?'sandbox':'disabled',realPaymentsEnabled:false,version:'prod-release-gated-v2'});
}
