-- REVIEW/APPLY ONLY AFTER APPROVAL. Existing production schema required.
-- This file is not applied remotely by build, tests, or deploy. No real financial data is modified here.
begin;
create table if not exists public.production_checkout_limits (
 scope_hash text primary key,
 window_start timestamptz not null,
 attempts integer not null check (attempts > 0)
);
alter table public.production_checkout_limits enable row level security;
revoke all on public.production_checkout_limits from public,anon,authenticated;
grant select,insert,update,delete on public.production_checkout_limits to service_role;

create or replace function public.consume_production_checkout_limit(p_ip text,p_buyer text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare k text; n integer; allowed boolean:=true;
begin
 if p_ip is null or p_buyer is null or p_ip !~ '^[a-f0-9]{64}$' or p_buyer !~ '^[a-f0-9]{64}$' then
   raise exception 'Invalid rate limit scope';
 end if;
 -- Fixed lock order, persistent across all serverless instances. No raw IP/CPF stored.
 foreach k in array array['ip:'||p_ip,'buyer:'||p_buyer] loop
   insert into public.production_checkout_limits(scope_hash,window_start,attempts) values(k,now(),1)
   on conflict(scope_hash) do update set
     window_start=case when production_checkout_limits.window_start<=now()-interval '15 minutes' then now() else production_checkout_limits.window_start end,
     attempts=case when production_checkout_limits.window_start<=now()-interval '15 minutes' then 1 else least(production_checkout_limits.attempts+1,1000) end
   returning attempts into n;
   if n>(case when k like 'ip:%' then 10 else 5 end) then allowed:=false; end if;
 end loop;
 return jsonb_build_object('allowed',allowed);
end;
$$;
revoke all on function public.consume_production_checkout_limit(text,text) from public,anon,authenticated;
grant execute on function public.consume_production_checkout_limit(text,text) to service_role;

create or replace function public.reserve_production_checkout(p_key text,p_hash text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.checkout_requests; c public.customers; o public.orders;
 q integer; pkg integer; total integer; initial integer;
begin
 if p_key is null or p_hash is null or p_data is null or length(p_key)<16 or length(p_key)>100 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-key:'||p_key,0));
 select * into r from public.checkout_requests where idempotency_key=p_key;
 if found then
   if r.request_hash<>p_hash then return jsonb_build_object('conflict',true); end if;
   return jsonb_build_object('claimed',false,'request',to_jsonb(r));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-hash:'||p_hash,0));
 select * into r from public.checkout_requests where request_hash=p_hash and (status in ('processing','needs_review') or created_at>now()-interval '15 minutes') order by created_at desc limit 1;
 if found then return jsonb_build_object('claimed',false,'request',to_jsonb(r)); end if;
 q:=(p_data->>'quantity')::integer; pkg:=(p_data->>'packageType')::integer;
 if q is null or pkg is null or p_data->>'paymentPlan' is null or q<1 or q>100 or pkg not in (1,3) or p_data->>'paymentPlan' not in ('cash','entry') then raise exception 'Invalid offer'; end if;
 total:=q * case when pkg=3 then 200000 else 100000 end * case when p_data->>'paymentPlan'='cash' then 9 else 10 end / 10;
 initial:=case when p_data->>'paymentPlan'='cash' then total else q*10000 end;
 perform pg_advisory_xact_lock(hashtextextended('buyer:'||(p_data->>'cpf'),0));
 select * into c from public.customers where tax_id=p_data->>'cpf' order by (asaas_customer_id is not null) desc,created_at desc limit 1;
 if found then
   select cr.* into r from public.checkout_requests cr join public.orders co on co.id=cr.order_id
   where co.customer_id=c.id and cr.status in ('processing','needs_review') order by cr.created_at desc limit 1;
   if found then return jsonb_build_object('claimed',false,'request',to_jsonb(r)); end if;
 end if;
 -- Serialized by CPF above; changing email/quantity/key cannot bypass these limits.
 if (select count(*) from public.orders o2 join public.customers c2 on c2.id=o2.customer_id
     where c2.tax_id=p_data->>'cpf' and (o2.status in ('pending','awaiting_payment','payment_review')
       or o2.reconciliation_required)) >= 1
    or (select count(*) from public.orders o2 join public.customers c2 on c2.id=o2.customer_id
     where c2.tax_id=p_data->>'cpf' and o2.created_at>now()-interval '24 hours') >= 3 then
   return jsonb_build_object('limited',true);
 end if;
 if c.id is null then
   insert into public.customers(full_name,email,phone,tax_id,city,state)
   values(p_data->>'fullName',p_data->>'email',p_data->>'phone',p_data->>'cpf',p_data->>'city',p_data->>'state') returning * into c;
 end if;
 insert into public.orders(customer_id,offer_type,package_quantity,coverage_quantity,payment_plan,total_cents,initial_due_cents,remaining_balance_cents)
 values(c.id,case when pkg=3 then 'package_3' else 'single' end,q,q*pkg,p_data->>'paymentPlan',total,initial,total-initial) returning * into o;
 insert into public.checkout_requests(idempotency_key,request_hash,order_id) values(p_key,p_hash,o.id) returning * into r;
 return jsonb_build_object('claimed',true,'request',to_jsonb(r),'customer',to_jsonb(c),'order',to_jsonb(o));
end;
$$;

-- The server passes a payment freshly retrieved from the Production API, never the webhook body.
-- One transaction locks the order, verifies identity, persists payment, calculates balance,
-- and acknowledges the audit event. Public clients cannot execute this function.
create or replace function public.apply_production_payment(p_remote jsonb,p_event_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; c public.customers; p public.payments;
 remote_id text:=p_remote->>'id'; s text:=p_remote->>'status'; amount integer;
 balance integer; settled boolean; needs_review boolean:=false; next_status text;
begin
 if p_event_id is not null then
   perform 1 from public.asaas_webhook_events where asaas_event_id=p_event_id
     and asaas_payment_id=remote_id for update;
   if not found then raise exception 'Event identity mismatch'; end if;
   if exists(select 1 from public.asaas_webhook_events where asaas_event_id=p_event_id and processed_at is not null) then
     return jsonb_build_object('duplicate',true);
   end if;
 end if;
 if remote_id is null or remote_id !~ '^pay_[A-Za-z0-9]+$' or s is null then raise exception 'Invalid payment identity'; end if;
 select * into o from public.orders where public_reference=p_remote->>'externalReference' for update;
 if not found then
   if exists(select 1 from public.payments where asaas_payment_id=remote_id) then raise exception 'Payment reference mismatch'; end if;
   if coalesce(p_remote->>'externalReference','') ~ '^FBP-' then raise exception 'Checkout order not yet registered'; end if;
   if p_event_id is not null then update public.asaas_webhook_events set processed_at=now(),processing_error='ignored_unrelated_payment' where asaas_event_id=p_event_id; end if;
   return jsonb_build_object('ignored',true);
 end if;
 select * into c from public.customers where id=o.customer_id;
 amount:=round((p_remote->>'value')::numeric*100)::integer;
 if amount is null or amount<>o.initial_due_cents then raise exception 'Payment amount mismatch'; end if;
 if c.asaas_customer_id is null or p_remote->>'customer' is distinct from c.asaas_customer_id then raise exception 'Payment customer mismatch'; end if;
 if p_remote->>'installment' is not null or p_remote->>'subscription' is not null then raise exception 'Recurring or installment payment rejected'; end if;
 select * into p from public.payments where asaas_payment_id=remote_id;
 if found and (p.order_id<>o.id or p.amount_cents<>amount) then raise exception 'Payment ownership mismatch'; end if;
 -- Asaas may settle a registered BOLETO through PIX without changing its ID.
 -- Do not accept a new/unbound PIX charge or broaden checkout creation methods.
 if p_remote->>'billingType' is distinct from 'BOLETO' then
   if p_remote->>'billingType' is distinct from 'PIX' then raise exception 'Unsupported payment billing type'; end if;
   if p.id is null or p.order_id is distinct from o.id or p.amount_cents is distinct from amount
      or p.billing_type is null or p.billing_type not in ('BOLETO','PIX') then
     raise exception 'Unregistered PIX payment';
   end if;
 end if;
 if (p_remote->>'deleted')::boolean is true then s:='DELETED'; end if;
 if exists(select 1 from public.payments where order_id=o.id and asaas_payment_id is distinct from remote_id) then raise exception 'Multiple initial charges require review'; end if;
 -- Never let an older read of pending/confirmed overwrite a settled/refunded snapshot.
 if p.status in ('REFUNDED','PARTIALLY_REFUNDED') and s not in ('REFUNDED','PARTIALLY_REFUNDED') then s:=p.status; end if;
 if p.status in ('RECEIVED','RECEIVED_IN_CASH') and s in ('PENDING','OVERDUE','CONFIRMED') then s:=p.status; end if;
 if p.status='DELETED' and s in ('PENDING','OVERDUE') then s:=p.status; end if;
 if p.status='CONFIRMED' and s in ('PENDING','OVERDUE') then s:=p.status; end if;
 settled:=s in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH');
 if s not in ('RECEIVED','CONFIRMED','RECEIVED_IN_CASH','PENDING','OVERDUE','DELETED','REFUNDED') then needs_review:=true; end if;
 balance:=case when settled then o.total_cents-amount else o.total_cents end;
 next_status:=case
   when s='REFUNDED' then 'refunded'
   when s='PARTIALLY_REFUNDED' then 'partially_refunded'
   when needs_review then 'payment_review'
   when settled and amount=o.total_cents then 'paid'
   when settled then 'entry_paid'
   when s='DELETED' then 'cancelled'
   else 'awaiting_payment' end;
 insert into public.payments(order_id,asaas_payment_id,billing_type,installment_count,amount_cents,status,payment_url,due_date,paid_at)
 values(o.id,remote_id,case when p.billing_type='PIX' then 'PIX' else p_remote->>'billingType' end,1,amount,s,p_remote->>'invoiceUrl',(p_remote->>'dueDate')::date,
 case when settled then coalesce((p_remote->>'paymentDate')::timestamptz,p.paid_at,now()) else p.paid_at end)
 on conflict(asaas_payment_id) do update set status=excluded.status,billing_type=excluded.billing_type,payment_url=excluded.payment_url,paid_at=excluded.paid_at,updated_at=now();
 -- Before initial payment the contractual balance excludes the first bill; after refund
 -- the full amount is outstanding. Partial refunds/chargebacks require manual accounting.
 if s in ('PENDING','OVERDUE') then balance:=o.total_cents-o.initial_due_cents; end if;
 update public.orders set status=next_status,remaining_balance_cents=balance,reconciliation_required=needs_review,updated_at=now() where id=o.id;
 if p_event_id is not null then
   update public.asaas_webhook_events set processed_at=now(),processing_error=case when needs_review then 'manual_financial_review_required' else null end where asaas_event_id=p_event_id;
 end if;
 return jsonb_build_object('reference',o.public_reference,'paymentStatus',s,'orderStatus',next_status,'remainingBalanceCents',balance,'reconciliationRequired',needs_review);
end;
$$;

revoke all on function public.reserve_production_checkout(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.apply_production_payment(jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_production_checkout(text,text,jsonb) to service_role;
grant execute on function public.apply_production_payment(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
