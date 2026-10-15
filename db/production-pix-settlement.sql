-- Apply only after approval. Replaces only the existing settlement function; no direct data update.
begin;
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

revoke all on function public.apply_production_payment(jsonb,text) from public,anon,authenticated;
grant execute on function public.apply_production_payment(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
