-- Monthly snapshots of OMG's cumulative Margin Report.
--
-- Always-open stores do not have a natural closeout. Saving one cumulative
-- snapshot per month lets the portal calculate the monthly change while still
-- retaining OMG's auditable all-time totals. Customer and rep are copied onto
-- each snapshot so historical attribution does not move if a store is later
-- reassigned.

create table public.omg_store_profit_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.omg_stores(id) on delete cascade,
  store_code text not null,
  period_month date not null,
  is_cumulative boolean not null default true,
  customer_id text references public.customers(id) on delete set null,
  rep_id text references public.team_members(id) on delete set null,
  products integer not null default 0 check (products >= 0),
  product_collected numeric(14,2) not null default 0,
  item_cost numeric(14,2) not null default 0,
  product_profit numeric(14,2) not null default 0,
  margin_pct numeric(9,4) not null default 0,
  refunds numeric(14,2) not null default 0,
  omg_fees numeric(14,2) not null default 0,
  processing_fees numeric(14,2) not null default 0,
  invoiced_fees numeric(14,2) not null default 0,
  net_profit numeric(14,2) not null default 0,
  source_file text,
  source_mode text not null default 'manual' check (source_mode in ('manual', 'omg_api')),
  source_sale_id text,
  validation_status text not null default 'pending' check (validation_status in ('pending', 'ready', 'held', 'error')),
  validation jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  imported_by text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omg_store_profit_snapshots_period_first
    check (period_month = date_trunc('month', period_month)::date),
  constraint omg_store_profit_snapshots_store_month_key
    unique (store_id, period_month)
);

create index omg_store_profit_snapshots_customer_month_idx
  on public.omg_store_profit_snapshots (customer_id, period_month desc);
create index omg_store_profit_snapshots_rep_month_idx
  on public.omg_store_profit_snapshots (rep_id, period_month desc);
create index omg_store_profit_snapshots_code_month_idx
  on public.omg_store_profit_snapshots (store_code, period_month desc);

alter table public.omg_store_profit_snapshots enable row level security;

create policy omg_store_profit_snapshots_staff_all
  on public.omg_store_profit_snapshots
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

-- New public-schema tables are not automatically exposed to the Data API on
-- newer Supabase projects, so grant the intended staff role explicitly.
grant select, insert, update, delete
  on public.omg_store_profit_snapshots
  to authenticated;
revoke all on public.omg_store_profit_snapshots from anon;

comment on table public.omg_store_profit_snapshots is
  'Monthly OMG profit totals, attributed to an NSA customer and rep. API rows are calendar-month totals; manual rows may be cumulative Margin Report snapshots.';
comment on column public.omg_store_profit_snapshots.product_profit is
  'OMG Margin Report profit: product_collected minus item_cost, before platform/payment fees.';
comment on column public.omg_store_profit_snapshots.net_profit is
  'Product profit less refunds, OMG fees, processing fees, and invoiced fees.';
