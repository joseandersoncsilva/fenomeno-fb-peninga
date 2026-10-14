import test from 'node:test';
import assert from 'node:assert/strict';
import { productionConfiguration, assertProductionPaymentsAllowed } from '../api/_lib/production-guard.js';

const keys=['VERCEL_ENV','FBP_PROD_SUPABASE_URL','FBP_PROD_SUPABASE_SECRET_KEY','ASAAS_API_KEY','FBP_PROD_ASAAS_WEBHOOK_TOKEN','FBP_PROD_STATUS_SECRET','FBP_PRODUCTION_PAYMENTS_ENABLED'];
const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
function setup(values){for(const key of keys)delete process.env[key];Object.assign(process.env,values);}
test('production charges remain blocked with an Asaas key alone',()=>{
 setup({VERCEL_ENV:'production',ASAAS_API_KEY:'fake-test-key'});
 assert.equal(productionConfiguration().explicitlyEnabled,false);
 assert.throws(()=>assertProductionPaymentsAllowed());
});
test('production charges remain blocked in Preview even with a full configuration',()=>{
 setup({VERCEL_ENV:'preview',FBP_PROD_SUPABASE_URL:'https://nnysmymyvsydikdwlprg.supabase.co',FBP_PROD_SUPABASE_SECRET_KEY:'fake',
 ASAAS_API_KEY:'fake',FBP_PROD_ASAAS_WEBHOOK_TOKEN:'fake',FBP_PROD_STATUS_SECRET:'x'.repeat(32),FBP_PRODUCTION_PAYMENTS_ENABLED:'true'});
 assert.throws(()=>assertProductionPaymentsAllowed());
});
test('production charges remain blocked if pointed to the sandbox database',()=>{
 setup({VERCEL_ENV:'production',FBP_PROD_SUPABASE_URL:'https://oqefeihbtmzandayxoat.supabase.co',FBP_PROD_SUPABASE_SECRET_KEY:'fake',
 ASAAS_API_KEY:'fake',FBP_PROD_ASAAS_WEBHOOK_TOKEN:'fake',FBP_PROD_STATUS_SECRET:'x'.repeat(32),FBP_PRODUCTION_PAYMENTS_ENABLED:'true'});
 assert.throws(()=>assertProductionPaymentsAllowed());
});
test('production charges remain blocked without the dedicated production status secret',()=>{
 setup({VERCEL_ENV:'production',FBP_PROD_SUPABASE_URL:'https://nnysmymyvsydikdwlprg.supabase.co',FBP_PROD_SUPABASE_SECRET_KEY:'fake',
 ASAAS_API_KEY:'fake',FBP_PROD_ASAAS_WEBHOOK_TOKEN:'fake',FBP_PRODUCTION_PAYMENTS_ENABLED:'true'});
 assert.throws(()=>assertProductionPaymentsAllowed());
});
test.after(()=>{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}});
