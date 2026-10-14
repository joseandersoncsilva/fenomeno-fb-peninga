// Safe post-publication smoke: no credentials, valid buyer, payment ID, or valid webhook.
// Run only against the production domain after an approved deployment with sales OFF.
import assert from 'node:assert/strict';
const origin='https://fenomeno-fb-peninga.vercel.app';
const request=async(path,method='GET')=>fetch(origin+path,{
 method,redirect:'error',signal:AbortSignal.timeout(15000),
 headers:{'Content-Type':'application/json','Cache-Control':'no-cache'},
 ...(method==='POST'?{body:'{}'}:{})
});
for(const [path,method,expected] of [
 ['/api/asaas-production-webhook','GET',405],
 ['/api/asaas-production-webhook','POST',401],
 ['/api/checkout','POST',503]
]){
 const response=await request(path,method);
 assert.equal(response.status,expected,`${method} ${path}: expected ${expected}, received ${response.status}`);
 console.log(`${method} ${path}: ${response.status}`);
}
const configResponse=await request('/api/checkout-config');assert.equal(configResponse.status,200);
const config=await configResponse.json();
assert.equal(config.environment,'production');assert.equal(config.enabled,false);assert.equal(config.realPaymentsEnabled,false);
const readinessResponse=await request('/api/production-readiness');assert.equal(readinessResponse.status,200);
const readiness=await readinessResponse.json();assert.equal(readiness.paymentsEnabled,false);assert.equal(readiness.checks.explicitRelease,false);
for(const check of ['productionDatabase','asaasAccountKey','webhookAuthentication','orderAccessSecret','abuseProtection'])assert.equal(readiness.checks[check],true,`${check} not ready`);
console.log('Production release checks passed with real payments OFF. This does not validate authenticated Asaas delivery.');
