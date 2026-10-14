begin;
do $$
declare d jsonb := '{"fullName":"Teste SQL Ficticio","email":"sql-test@example.com","phone":"11900000000","cpf":"00000000000","city":"Cidade Teste","state":"BA","packageType":3,"quantity":1,"paymentPlan":"entry"}';
 r jsonb; replay jsonb; result jsonb; remote jsonb; order_id uuid; customer_id uuid; count_before bigint;
begin
 select count(*) into count_before from public.orders;
 r:=public.reserve_sandbox_checkout('sql-rollback-idempotency',repeat('a',64),d);
 assert (r->>'claimed')::boolean,'First reservation not claimed';
 order_id:=(r->'order'->>'id')::uuid;customer_id:=(r->'customer'->>'id')::uuid;
 replay:=public.reserve_sandbox_checkout('sql-rollback-idempotency',repeat('a',64),d);
 assert not (replay->>'claimed')::boolean,'Duplicate claimed';
 assert replay->'request'->>'order_id'=order_id::text,'Different duplicate order';
 replay:=public.reserve_sandbox_checkout('sql-rollback-idempotency',repeat('b',64),d);
 assert (replay->>'conflict')::boolean,'Changed payload accepted';
 replay:=public.reserve_sandbox_checkout('sql-rollback-alt-idempotency',repeat('a',64),d);
 assert not (replay->>'claimed')::boolean,'Same cart claimed with different key';
 assert (select count(*) from public.orders)=count_before+1,'Multiple orders created';
 update public.customers set asaas_customer_id='cus_sqlfixture' where id=customer_id;
 remote:=jsonb_build_object('id','pay_sqlfixture','status','PENDING','value',100,'customer','cus_sqlfixture','externalReference',r->'order'->>'public_reference','billingType','BOLETO','dueDate','2026-10-15','invoiceUrl','https://sandbox.asaas.com/i/sqlfixture');
 result:=public.apply_sandbox_payment(remote);
 assert result->>'orderStatus'='awaiting_payment','Pending unexpectedly paid';
 begin
   perform public.apply_sandbox_payment(remote||'{"value":1}'::jsonb);
   raise exception 'Mismatch incorrectly accepted';
 exception when others then
   if sqlerrm='Mismatch incorrectly accepted' then raise;end if;
 end;
 begin
   perform public.apply_sandbox_payment(remote||'{"customer":"cus_wrong"}'::jsonb);
   raise exception 'Wrong buyer incorrectly accepted';
 exception when others then
   if sqlerrm='Wrong buyer incorrectly accepted' then raise;end if;
 end;
 result:=public.apply_sandbox_payment(remote||'{"status":"RECEIVED","paymentDate":"2026-10-10"}'::jsonb);
 assert result->>'orderStatus'='entry_paid','Entry not settled';
 assert (result->>'remainingBalanceCents')::integer=190000,'Entry balance wrong';
 result:=public.apply_sandbox_payment(remote);
 assert result->>'orderStatus'='entry_paid','Stale pending regressed paid state';
 assert (select count(*) from public.payments where payments.order_id=(r->'order'->>'id')::uuid)=1,'Duplicate payment';
 result:=public.apply_sandbox_payment(remote||'{"status":"REFUNDED"}'::jsonb);
 assert result->>'orderStatus'='refunded','Refund not reflected';
 assert (result->>'remainingBalanceCents')::integer=200000,'Refund balance wrong';
 result:=public.apply_sandbox_payment(remote||'{"status":"RECEIVED"}'::jsonb);
 assert result->>'orderStatus'='refunded','Stale event resurrected refund';
 result:=public.apply_sandbox_payment(remote||'{"id":"pay_unrelated","externalReference":"OTHER","customer":"cus_other"}'::jsonb);
 assert (result->>'ignored')::boolean,'Unrelated payment not ignored';
end;
$$;
rollback;
select 'SQL assertions passed; all fixtures rolled back' as result;
