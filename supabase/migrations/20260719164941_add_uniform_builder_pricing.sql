-- Customer-specific custom-uniform pricing plus an immutable snapshot on each
-- builder order. Staff manage the discount; coaches can only see the resolved
-- price passed into their authenticated portal session.

alter table if exists public.customers
  add column if not exists uniform_discount_percent numeric(5,2) not null default 0;

alter table if exists public.customers
  drop constraint if exists customers_uniform_discount_percent_check;

alter table if exists public.customers
  add constraint customers_uniform_discount_percent_check
  check (uniform_discount_percent >= 0 and uniform_discount_percent <= 100);

alter table if exists public.uniform_order_requests
  add column if not exists public_unit_price numeric not null default 0,
  add column if not exists discount_percent numeric(5,2) not null default 0,
  add column if not exists discount_total numeric not null default 0,
  add column if not exists pricing_breakdown jsonb not null default '{}'::jsonb;

comment on column public.customers.uniform_discount_percent is
  'Discount from the public custom-uniform price shown to this coach account.';

comment on column public.uniform_order_requests.pricing_breakdown is
  'Submitted price snapshot including base, fabric, decoration, and discount adjustments.';
