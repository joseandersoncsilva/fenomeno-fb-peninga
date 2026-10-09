-- FB Peninga: orders and payment events. Execute once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.fbp_orders (
 id uuid primary key default gen_random_uuid(),
 public_reference text not null unique,
 buyer_name text not null,
 buyer_cpf text not null,
 buyer_email text not null,
 buyer_phone text not null,
 buyer_city text not null,
 buyer_state char(2) not null,
 package_size smallint not null check (package_size in (1,3)),
 quantity integer not null check (quantity between 1 and 500),
 cover_count integer generated always as (package_size * quantity) stored,
 payment_method text not null check (payment_method in ('installments','cash')),
 contract_cents integer not null check (contract_cents > 0),
 initial_cents integer not null check (initial_cents > 0),
 status text not null default 'draft' check (status in ('draft','creating_charge','pending','confirmed','received','overdue','cancelled','refunded','error')),
 asaas_customer_id text,
 asaas_payment_id text unique,
 asaas_invoice_url text,
 asaas_bankslip_url text,
 due_date date,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists fbp_orders_status_idx on public.fbp_orders(status,created_at desc);
create table if not exists public.fbp_payment_events (
 event_id text primary key,
 order_id uuid references public.fbp_orders(id),
 asaas_payment_id text,
 event_type text not null,
 received_at timestamptz not null default now()
);
alter table public.fbp_orders enable row level security;
alter table public.fbp_payment_events enable row level security;
-- No anonymous or authenticated client policies: only trusted backend uses service role.
revoke all on public.fbp_orders from anon, authenticated;
revoke all on public.fbp_payment_events from anon, authenticated;
