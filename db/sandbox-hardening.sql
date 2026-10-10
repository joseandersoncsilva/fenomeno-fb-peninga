begin;

alter table public.customers add column if not exists city text;
alter table public.customers add column if not exists state text;
alter table public.orders add column if not exists reconciliation_required boolean not null default false;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in ('pending','awaiting_payment','entry_paid','paid','cancelled','refunded','partially_refunded','payment_review'));
alter table public.orders drop constraint if exists orders_amounts_match;
alter table public.orders add constraint orders_amounts_match check (
 coverage_quantity = package_quantity * case when offer_type='package_3' then 3 else 1 end
 and total_cents = package_quantity * case when offer_type='package_3' then 200000 else 100000 end * case when payment_plan='cash' then 9 else 10 end / 10
 and initial_due_cents = case when payment_plan='cash' then total_cents else package_quantity * 10000 end
 and remaining_balance_cents between 0 and total_cents
);

create table if not exists public.checkout_requests (
 idempotency_key text primary key,
 request_hash text not null,
 order_id uuid not null references public.orders(id),
 status text not null default 'processing' check (status in ('processing','completed','needs_review')),
 response jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists checkout_requests_hash_time on public.checkout_requests(request_hash,created_at desc);
create index if not exists checkout_requests_order on public.checkout_requests(order_id);
alter table public.checkout_requests enable row level security;
revoke all on public.checkout_requests from anon,authenticated;
grant select,insert,update on public.checkout_requests to service_role;

create table if not exists public.sandbox_verification_runs (
 run_id text primary key,
 status text not null check (status in ('running','passed','failed')),
 results jsonb not null default '{}'::jsonb,
 started_at timestamptz not null default now(),
 finished_at timestamptz
);
alter table public.sandbox_verification_runs enable row level security;
revoke all on public.sandbox_verification_runs from anon,authenticated;
grant select,insert,update on public.sandbox_verification_runs to service_role;

create or replace function public.reserve_sandbox_checkout(p_key text,p_hash text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.checkout_requests; c public.customers; o public.orders;
 q integer; pkg integer; total integer; initial integer;
begin
 if length(p_key)<16 or length(p_key)>100 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid reservation'; end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-key:'||p_key,0));
 select * into r from public.checkout_requests where idempotency_key=p_key;
 if found then
   if r.request_hash<>p_hash then return jsonb_build_object('conflict',true); end if;
   return jsonb_build_object('claimed',false,'request',to_jsonb(r));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('checkout-hash:'||p_hash,0));
 select * into r from public.checkout_requests where request_hash=p_hash and created_at>now()-interval '15 minutes' order by created_at desc limit 1;
 if found then return jsonb_build_object('claimed',false,'request',to_jsonb(r)); end if;
 q:=(p_data->>'quantity')::integer; pkg:=(p_data->>'packageType')::integer;
 if q<1 or q>100 or pkg not in (1,3) or p_data->>'paymentPlan' not in ('cash','entry') then raise exception 'Invalid offer'; end if;
 total:=q * case when pkg=3 then 200000 else 100000 end * case when p_data->>'paymentPlan'='cash' then 9 else 10 end / 10;
 initial:=case when p_data->>'paymentPlan'='cash' then total else q*10000 end;
 perform pg_advisory_xact_lock(hashtextextended('buyer:'||(p_data->>'cpf'),0));
 select * into c from public.customers where tax_id=p_data->>'cpf' order by (asaas_customer_id is not null) desc,created_at desc limit 1;
 if found and c.asaas_customer_id is null then
   select cr.* into r from public.checkout_requests cr join public.orders co on co.id=cr.order_id
   where co.customer_id=c.id and cr.status in ('processing','needs_review') order by cr.created_at desc limit 1;
   if found then return jsonb_build_object('claimed',false,'request',to_jsonb(r)); end if;
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

-- The server passes a payment freshly retrieved from the Sandbox API, never the webhook body.
-- One transaction locks the order, verifies identity, persists payment, calculates balance,
-- and acknowledges the audit event. Public clients cannot execute this function.
create or replace function public.apply_sandbox_payment(p_remote jsonb,p_event_id text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.orders; c public.customers; p public.payments;
 remote_id text:=p_remote->>'id'; s text:=p_remote->>'status'; amount integer;
 balance integer; settled boolean; needs_review boolean:=false; next_status text;
begin
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
 if amount<>o.initial_due_cents or p_remote->>'customer' is distinct from c.asaas_customer_id or p_remote->>'billingType'<>'BOLETO'
   or p_remote->>'installment' is not null or p_remote->>'subscription' is not null then raise exception 'Payment identity or amount mismatch'; end if;
 if (p_remote->>'deleted')::boolean is true then s:='DELETED'; end if;
 select * into p from public.payments where asaas_payment_id=remote_id;
 if found and (p.order_id<>o.id or p.amount_cents<>amount) then raise exception 'Payment ownership mismatch'; end if;
 if exists(select 1 from public.payments where order_id=o.id and asaas_payment_id is distinct from remote_id) then raise exception 'Multiple initial charges require review'; end if;
 -- Never let an older read of pending/confirmed overwrite a settled/refunded snapshot.
 if p.status in ('REFUNDED','PARTIALLY_REFUNDED') and s not in ('REFUNDED','PARTIALLY_REFUNDED') then s:=p.status; end if;
 if p.status in ('RECEIVED','RECEIVED_IN_CASH') and s in ('PENDING','OVERDUE','CONFIRMED') then s:=p.status; end if;
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
 values(o.id,remote_id,'BOLETO',1,amount,s,p_remote->>'invoiceUrl',(p_remote->>'dueDate')::date,
 case when settled then coalesce((p_remote->>'paymentDate')::timestamptz,p.paid_at,now()) else p.paid_at end)
 on conflict(asaas_payment_id) do update set status=excluded.status,payment_url=excluded.payment_url,paid_at=excluded.paid_at,updated_at=now();
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

revoke all on function public.reserve_sandbox_checkout(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.apply_sandbox_payment(jsonb,text) from public,anon,authenticated;
grant execute on function public.reserve_sandbox_checkout(text,text,jsonb) to service_role;
grant execute on function public.apply_sandbox_payment(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
