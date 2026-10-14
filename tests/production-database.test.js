import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const data={fullName:'Fixture SQL',email:'fixture@example.com',phone:'11900000000',cpf:'00000000000',city:'Cidade Teste',state:'BA',packageType:3,quantity:1,paymentPlan:'entry'};
const call=async(name,args)=>{const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');return (await db.query(`select public.${name}(${placeholders}) as result`,args)).rows[0].result;};
const reserve=(key='fixture-key-12345',hash='a'.repeat(64),d=data)=>call('reserve_production_checkout',[key,hash,d]);
const apply=(remote,event=null)=>call('apply_production_payment',[remote,event]);
async function payment(){const r=await reserve();await db.query("update customers set asaas_customer_id='cus_fixture'");return {id:'pay_fixture',customer:'cus_fixture',externalReference:r.order.public_reference,billingType:'BOLETO',value:100,status:'PENDING'};}
test.before(async()=>{
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create table customers(id uuid primary key default gen_random_uuid(), full_name text,email text,phone text,tax_id text,city text,state text,asaas_customer_id text,created_at timestamptz default now());
 create table orders(id uuid primary key default gen_random_uuid(), customer_id uuid references customers(id),public_reference text unique default ('FBP-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),offer_type text,package_quantity integer,coverage_quantity integer,payment_plan text,total_cents integer,initial_due_cents integer,remaining_balance_cents integer,status text default 'pending',reconciliation_required boolean default false,created_at timestamptz default now(),updated_at timestamptz default now());
 create table payments(id uuid primary key default gen_random_uuid(),order_id uuid references orders(id),asaas_payment_id text unique,billing_type text,installment_count integer,amount_cents integer,status text,payment_url text,due_date date,paid_at timestamptz,updated_at timestamptz default now());
 create table checkout_requests(idempotency_key text primary key,request_hash text,order_id uuid references orders(id),status text default 'processing',response jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
 create table asaas_webhook_events(asaas_event_id text primary key,asaas_payment_id text,event_type text,processed_at timestamptz,processing_error text);
 `);
 await db.exec(await readFile(new URL('../db/production-hardening.sql',import.meta.url),'utf8'));
});
test.beforeEach(async()=>{await db.exec('truncate customers,orders,payments,checkout_requests,asaas_webhook_events,production_checkout_limits cascade');});
test.after(async()=>{await db.close();});
test('SQL prices for all offers; forged monetary fields ignored',async()=>{
 let i=0;
 for(const [packageType,paymentPlan,total,initial] of [[3,'entry',200000,10000],[1,'entry',100000,10000],[3,'cash',180000,180000],[1,'cash',90000,90000]]){
  const r=await reserve('fixture-key-'+(++i)+'-123456',String(i).repeat(64),{...data,cpf:'fixture'+i,quantity:2,packageType,paymentPlan,total_cents:1,initial_due_cents:1});
  assert.equal(r.order.total_cents,total*2);assert.equal(r.order.initial_due_cents,initial*2);
 }
});
test('SQL idempotency, changed payload, and alternate key cannot duplicate order',async()=>{
 const r=await reserve();const replay=await reserve();assert.equal(replay.claimed,false);assert.equal(replay.request.order_id,r.order.id);
 assert.equal((await reserve('fixture-key-12345','b'.repeat(64))).conflict,true);
 assert.equal((await reserve('alternate-key-12345')).claimed,false);
 assert.equal((await db.query('select count(*)::integer as n from orders')).rows[0].n,1);
});
test('SQL pending order limit survives changed cart and idempotency key',async()=>{
 await payment();await db.exec("update checkout_requests set status='completed'; update orders set status='awaiting_payment'");
 const r=await reserve('new-cart-key-12345','b'.repeat(64),{...data,quantity:2});assert.equal(r.limited,true);
});
test('SQL rate limit persists, has separate IP and buyer limits, resets after window',async()=>{
 for(let i=0;i<5;i++)assert.equal((await call('consume_production_checkout_limit',['a'.repeat(64),'b'.repeat(64)])).allowed,true);
 assert.equal((await call('consume_production_checkout_limit',['c'.repeat(64),'b'.repeat(64)])).allowed,false);
 await db.exec("update production_checkout_limits set window_start=now()-interval '16 minutes'");
 assert.equal((await call('consume_production_checkout_limit',['a'.repeat(64),'b'.repeat(64)])).allowed,true);
 for(let i=0;i<9;i++)assert.equal((await call('consume_production_checkout_limit',['a'.repeat(64),String(i).repeat(64)])).allowed,true);
 assert.equal((await call('consume_production_checkout_limit',['a'.repeat(64),'f'.repeat(64)])).allowed,false);
});
test('SQL remote payment identity rejects wrong/missing amount, customer, type and installments',async()=>{
 const remote=await payment();
 for(const bad of [{value:1},{value:null},{customer:'cus_other'},{billingType:null},{billingType:'PIX'},{installment:'ins_fixture'},{subscription:'sub_fixture'}])await assert.rejects(apply({...remote,...bad}));
 assert.equal((await db.query('select count(*)::integer as n from payments')).rows[0].n,0);
});
test('SQL entry is not paid in full; duplicate/stale events do not regress receipt or duplicate payment',async()=>{
 const remote=await payment();await db.query("insert into asaas_webhook_events values ('evt_fixture','pay_fixture','PAYMENT_RECEIVED',null,null)");
 const result=await apply({...remote,status:'RECEIVED'},'evt_fixture');assert.equal(result.orderStatus,'entry_paid');assert.equal(result.remainingBalanceCents,190000);
 assert.equal((await apply(remote,'evt_fixture')).duplicate,true);assert.equal((await apply(remote)).orderStatus,'entry_paid');
 assert.equal((await db.query('select count(*)::integer as n from payments')).rows[0].n,1);
 await apply({...remote,status:'REFUNDED'});assert.equal((await apply({...remote,status:'RECEIVED'})).orderStatus,'refunded');
});
test('SQL transaction failure leaves event unacknowledged for retry',async()=>{
 const remote=await payment();await db.query("insert into asaas_webhook_events values ('evt_fixture','pay_fixture','PAYMENT_RECEIVED',null,null)");
 await assert.rejects(apply({...remote,value:1},'evt_fixture'));
 assert.equal((await db.query('select processed_at from asaas_webhook_events')).rows[0].processed_at,null);
 assert.equal((await apply({...remote,status:'RECEIVED'},'evt_fixture')).orderStatus,'entry_paid');
});
test('SQL anonymous/authenticated clients cannot forge financial RPCs or use rate table',async()=>{
 for(const role of ['anon','authenticated']){
  for(const signature of ['reserve_production_checkout(text,text,jsonb)','apply_production_payment(jsonb,text)','consume_production_checkout_limit(text,text)'])assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') as allowed',[role,signature])).rows[0].allowed,false);
  assert.equal((await db.query('select has_table_privilege($1,\'production_checkout_limits\',\'select,insert,update\') as allowed',[role])).rows[0].allowed,false);
 }
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='production_checkout_limits'")).rows[0].relrowsecurity,true);
});
test('SQL daily buyer cap allows at most three orders even after settlement',async()=>{
 for(let i=0;i<3;i++){
  const r=await reserve('daily-key-123456-'+i,String(i).repeat(64));assert.equal(r.claimed,true);
  await db.exec("update orders set status='entry_paid'; update checkout_requests set status='completed'");
 }
 assert.equal((await reserve('daily-key-123456-4','f'.repeat(64))).limited,true);
});
test('SQL cash settlement is fully paid; cancellation cannot regress to pending',async()=>{
 const r=await reserve('cash-key-123456789','c'.repeat(64),{...data,paymentPlan:'cash'});
 await db.exec("update customers set asaas_customer_id='cus_fixture'");
 const remote={id:'pay_cash',customer:'cus_fixture',externalReference:r.order.public_reference,billingType:'BOLETO',value:1800,status:'RECEIVED'};
 const paid=await apply(remote);assert.equal(paid.orderStatus,'paid');assert.equal(paid.remainingBalanceCents,0);
 await apply({...remote,status:'DELETED'});assert.equal((await apply({...remote,status:'PENDING'})).orderStatus,'cancelled');
});
