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
   webhookConfigured:Boolean(env.FBP_PROD_ASAAS_WEBHOOK_TOKEN && env.FBP_PROD_ASAAS_WEBHOOK_TOKEN.length>=32),
   statusSecretConfigured:Boolean(env.FBP_PROD_STATUS_SECRET && env.FBP_PROD_STATUS_SECRET.length>=32),
   abuseProtectionConfigured:Boolean(env.FBP_TURNSTILE_SECRET_KEY && env.FBP_TURNSTILE_SITE_KEY && /^https:\/\/[^/]+$/.test(env.FBP_CHECKOUT_ORIGIN || '')),
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
// Reading/reconciling existing payments remains available during a sales pause.
export function assertProductionIntegrationAllowed() {
 const s=productionConfiguration();
 if(!s.databaseConfigured||!s.asaasConfigured||!s.runningInProduction)
  throw new Error('Production integration unavailable');
}
export function assertProductionStatusAllowed() {
 assertProductionIntegrationAllowed();
 if(!productionConfiguration().statusSecretConfigured)throw new Error('Status unavailable');
}
export async function productionDb(path,options={}) {
 assertProductionIntegrationAllowed();
 const {method='GET',body,prefer}=options;
 const res=await fetch(expectedUrl+'/rest/v1/'+path,{
  method,signal:AbortSignal.timeout(12000),redirect:'error',
  headers:{apikey:process.env.FBP_PROD_SUPABASE_SECRET_KEY,
    Authorization:'Bearer '+process.env.FBP_PROD_SUPABASE_SECRET_KEY,
    'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!res.ok){
  let code='unknown';
  try {const err=await res.json();code=String(err.code||'unknown').slice(0,24);}catch{}
  console.error('Production DB request failed',JSON.stringify({status:res.status,code,operation:path.startsWith('rpc/')?path.split('?')[0]:'table'}));
  throw new Error('Production database operation failed: '+res.status);
 }
 const payload=await res.text();
 return payload.trim()?JSON.parse(payload):null;
}

export async function productionAsaas(path,{method='GET',body}={}) {
 if(method==='GET')assertProductionIntegrationAllowed();
 else assertProductionPaymentsAllowed();
 const response=await fetch('https://api.asaas.com/v3'+path,{
  method,signal:AbortSignal.timeout(12000),redirect:'error',
  headers:{'Content-Type':'application/json',access_token:process.env.ASAAS_API_KEY,'User-Agent':'FBPeningaCheckout/1.0'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 if(!response.ok)throw new Error('Production Asaas HTTP '+response.status);
 if(response.status===204)return null;
 return response.json();
}
