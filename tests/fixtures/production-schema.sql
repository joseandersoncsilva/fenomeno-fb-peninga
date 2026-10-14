-- Schema-only snapshot from production catalog, 2026-10-14. No customer/payment rows.
create table public.asaas_webhook_events (
 id uuid default gen_random_uuid() not null,
 asaas_event_id text not null,
 event_type text not null,
 asaas_payment_id text,
 payload jsonb not null,
 received_at timestamp with time zone default now() not null,
 processed_at timestamp with time zone,
 processing_error text
);
create table public.checkout_requests (
 idempotency_key text not null,
 request_hash text not null,
 order_id uuid not null,
 status text default 'processing'::text not null,
 response jsonb,
 created_at timestamp with time zone default now() not null,
 updated_at timestamp with time zone default now() not null
);
create table public.customers (
 id uuid default gen_random_uuid() not null,
 full_name text not null,
 email text,
 phone text,
 tax_id text,
 asaas_customer_id text,
 city text,
 state text,
 created_at timestamp with time zone default now() not null,
 updated_at timestamp with time zone default now() not null
);
create table public.orders (
 id uuid default gen_random_uuid() not null,
 customer_id uuid not null,
 public_reference text default ('FBP-'::text || upper(substr(replace((gen_random_uuid())::text, '-'::text, ''::text), 1, 12))) not null,
 offer_type text not null,
 package_quantity integer default 1 not null,
 coverage_quantity integer not null,
 payment_plan text not null,
 total_cents integer not null,
 initial_due_cents integer not null,
 remaining_balance_cents integer not null,
 currency text default 'BRL'::text not null,
 status text default 'pending'::text not null,
 reconciliation_required boolean default false not null,
 created_at timestamp with time zone default now() not null,
 updated_at timestamp with time zone default now() not null
);
create table public.payments (
 id uuid default gen_random_uuid() not null,
 order_id uuid not null,
 asaas_payment_id text,
 asaas_installment_id text,
 billing_type text,
 installment_count integer,
 amount_cents integer not null,
 status text default 'PENDING'::text not null,
 payment_url text,
 paid_at timestamp with time zone,
 due_date date,
 created_at timestamp with time zone default now() not null,
 updated_at timestamp with time zone default now() not null
);
alter table public.asaas_webhook_events add constraint asaas_webhook_events_asaas_event_id_key UNIQUE (asaas_event_id);
alter table public.asaas_webhook_events add constraint asaas_webhook_events_pkey PRIMARY KEY (id);
alter table public.checkout_requests add constraint checkout_requests_pkey PRIMARY KEY (idempotency_key);
alter table public.checkout_requests add constraint checkout_requests_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'needs_review'::text])));
alter table public.customers add constraint customers_asaas_customer_id_key UNIQUE (asaas_customer_id);
alter table public.customers add constraint customers_full_name_check CHECK ((length(TRIM(BOTH FROM full_name)) > 1));
alter table public.customers add constraint customers_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_amounts_match CHECK (((coverage_quantity = (package_quantity *
CASE
    WHEN (offer_type = 'package_3'::text) THEN 3
    ELSE 1
END)) AND (total_cents = (((package_quantity *
CASE
    WHEN (offer_type = 'package_3'::text) THEN 200000
    ELSE 100000
END) *
CASE
    WHEN (payment_plan = 'cash'::text) THEN 9
    ELSE 10
END) / 10)) AND (initial_due_cents =
CASE
    WHEN (payment_plan = 'cash'::text) THEN total_cents
    ELSE (package_quantity * 10000)
END) AND ((remaining_balance_cents >= 0) AND (remaining_balance_cents <= total_cents))));
alter table public.orders add constraint orders_coverage_quantity_check CHECK ((coverage_quantity > 0));
alter table public.orders add constraint orders_currency_check CHECK ((currency = 'BRL'::text));
alter table public.orders add constraint orders_initial_due_cents_check CHECK ((initial_due_cents > 0));
alter table public.orders add constraint orders_offer_type_check CHECK ((offer_type = ANY (ARRAY['package_3'::text, 'single'::text])));
alter table public.orders add constraint orders_package_quantity_check CHECK (((package_quantity >= 1) AND (package_quantity <= 100)));
alter table public.orders add constraint orders_payment_plan_check CHECK ((payment_plan = ANY (ARRAY['entry'::text, 'cash'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_public_reference_key UNIQUE (public_reference);
alter table public.orders add constraint orders_remaining_balance_cents_check CHECK ((remaining_balance_cents >= 0));
alter table public.orders add constraint orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'awaiting_payment'::text, 'entry_paid'::text, 'paid'::text, 'cancelled'::text, 'refunded'::text, 'partially_refunded'::text, 'payment_review'::text])));
alter table public.orders add constraint orders_total_cents_check CHECK ((total_cents > 0));
alter table public.payments add constraint payments_amount_cents_check CHECK ((amount_cents > 0));
alter table public.payments add constraint payments_asaas_payment_id_key UNIQUE (asaas_payment_id);
alter table public.payments add constraint payments_billing_type_check CHECK ((billing_type = ANY (ARRAY['PIX'::text, 'BOLETO'::text, 'CREDIT_CARD'::text, 'UNDEFINED'::text])));
alter table public.payments add constraint payments_installment_count_check CHECK (((installment_count >= 1) AND (installment_count <= 20)));
alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
alter table public.checkout_requests add constraint checkout_requests_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
alter table public.payments add constraint payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
CREATE INDEX webhook_payment_idx ON public.asaas_webhook_events USING btree (asaas_payment_id);
CREATE INDEX checkout_requests_hash_time ON public.checkout_requests USING btree (request_hash, created_at DESC);
CREATE INDEX checkout_requests_order ON public.checkout_requests USING btree (order_id);
CREATE INDEX customers_tax_idx ON public.customers USING btree (tax_id);
CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);
CREATE INDEX payments_order_idx ON public.payments USING btree (order_id);
CREATE OR REPLACE FUNCTION public.apply_production_payment(p_remote jsonb, p_event_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.reserve_production_checkout(p_key text, p_hash text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 select * into r from public.checkout_requests where request_hash=p_hash and (status in ('processing','needs_review') or created_at>now()-interval '15 minutes') order by created_at desc limit 1;
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
$function$
;

