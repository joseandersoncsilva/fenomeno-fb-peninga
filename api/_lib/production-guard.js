// Production payment integration guard.
// Presence of an Asaas production key MUST NOT enable charges by itself.
// This module is not a public checkout endpoint.
const expectedRef='nnysmymyvsydikdwlprg';
const expectedUrl='https://'+expectedRef+'.supabase.co';

export function productionConfiguration() {
 const env=process.env;
 return {
   databaseConfigured: env.FBP_PROD_SUPABASE_URL===expectedUrl && Boolean(env.FBP_PROD_SUPABASE_SECRET_KEY),
   asaasConfigured:Boolean(env.ASAAS_API_KEY),
   webhookConfigured:Boolean(env.FBP_PROD_ASAAS_WEBHOOK_TOKEN),
   statusSecretConfigured:Boolean(env.FBP_PROD_STATUS_SECRET && env.FBP_PROD_STATUS_SECRET.length>=32),
   explicitlyEnabled:env.FBP_PRODUCTION_PAYMENTS_ENABLED==='true',
   runningInProduction:env.VERCEL_ENV==='production'
 };
}
export function assertProductionPaymentsAllowed() {
 const state=productionConfiguration();
 if(!Object.values(state).every(Boolean)) throw new Error('Production financial operations disabled or not configured');
 // The final go-live still requires explicit approval, correct receiver, and tests.
 return true;
}
export async function productionDb(path,options={}) {
 assertProductionPaymentsAllowed();
 const {method='GET',body,prefer}=options;
 const res=await fetch(expectedUrl+'/rest/v1/'+path,{
  method,signal:AbortSignal.timeout(12000),redirect:'error',
  headers:{apikey:process.env.FBP_PROD_SUPABASE_SECRET_KEY,
    Authorization:'Bearer '+process.env.FBP_PROD_SUPABASE_SECRET_KEY,
    'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!res.ok)throw new Error('Production database operation failed: '+res.status);
 const payload=await res.text();
 return payload.trim()?JSON.parse(payload):null;
}

export async function productionAsaas(path,{method='GET',body}={}) {
 assertProductionPaymentsAllowed();
 const response=await fetch('https://api.asaas.com/v3'+path,{
  method,signal:AbortSignal.timeout(12000),redirect:'error',
  headers:{'Content-Type':'application/json',access_token:process.env.ASAAS_API_KEY,'User-Agent':'FBPeningaCheckout/1.0'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!response.ok)throw new Error('Production Asaas HTTP '+response.status);
 if(response.status===204)return null;
 return response.json();
}
