-- Nightly OMG audit trail and frozen month-end commission rows.
-- The service-role nightly job writes both tables. Browser access stays limited
-- to active portal staff, matching the existing commission_snapshots policy.

create table public.omg_profit_sync_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default current_date,
  status text not null default 'running' check (status in ('running', 'complete', 'partial', 'failed')),
  stores_requested integer not null default 0,
  stores_synced integer not null default 0,
  stores_held integer not null default 0,
  commissions_finalized integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index omg_profit_sync_runs_date_idx
  on public.omg_profit_sync_runs (run_date desc, started_at desc);

create table public.omg_store_profit_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.omg_stores(id) on delete cascade,
  store_code text not null,
  snapshot_date date not null,
  period_month date not null,
  customer_id text references public.customers(id) on delete set null,
  rep_id text references public.team_members(id) on delete set null,
  products integer not null default 0 check (products >= 0),
  product_collected numeric(14,2) not null default 0,
  item_cost numeric(14,2) not null default 0,
  product_profit numeric(14,2) not null default 0,
  refunds numeric(14,2) not null default 0,
  omg_fees numeric(14,2) not null default 0,
  processing_fees numeric(14,2) not null default 0,
  invoiced_fees numeric(14,2) not null default 0,
  net_profit numeric(14,2) not null default 0,
  validation_status text not null check (validation_status in ('ready', 'held', 'error')),
  validation jsonb not null default '{}'::jsonb,
  sync_run_id uuid references public.omg_profit_sync_runs(id) on delete set null,
  captured_at timestamptz not null default now(),
  unique (store_id, snapshot_date),
  constraint omg_store_profit_daily_period_first
    check (period_month = date_trunc('month', period_month)::date)
);

create index omg_store_profit_daily_code_date_idx
  on public.omg_store_profit_daily_snapshots (store_code, snapshot_date desc);

create table public.omg_store_commission_months (
  id uuid primary key default gen_random_uuid(),
  store_id text not null references public.omg_stores(id) on delete cascade,
  store_code text not null,
  period_month date not null,
  customer_id text references public.customers(id) on delete set null,
  rep_id text references public.team_members(id) on delete set null,
  product_collected numeric(14,2) not null default 0,
  item_cost numeric(14,2) not null default 0,
  product_profit numeric(14,2) not null default 0,
  fees_and_refunds numeric(14,2) not null default 0,
  net_profit numeric(14,2) not null default 0,
  commission_basis text not null check (commission_basis in ('gp', 'revenue')),
  commission_rate numeric(8,6) not null,
  commission_amount numeric(14,2) not null default 0,
  status text not null default 'held' check (status in ('held', 'finalized')),
  hold_reason text,
  validation jsonb not null default '{}'::jsonb,
  source_snapshot_id uuid references public.omg_store_profit_snapshots(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omg_store_commission_months_period_first
    check (period_month = date_trunc('month', period_month)::date),
  unique (store_id, period_month)
);

create index omg_store_commission_months_rep_month_idx
  on public.omg_store_commission_months (rep_id, period_month desc);
create index omg_store_commission_months_status_idx
  on public.omg_store_commission_months (status, period_month desc);

alter table public.omg_profit_sync_runs enable row level security;
alter table public.omg_store_profit_daily_snapshots enable row level security;
alter table public.omg_store_commission_months enable row level security;

create policy omg_profit_sync_runs_staff_all on public.omg_profit_sync_runs
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy omg_store_profit_daily_staff_all on public.omg_store_profit_daily_snapshots
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());
create policy omg_store_commission_months_staff_all on public.omg_store_commission_months
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

grant select, insert, update, delete on public.omg_profit_sync_runs to authenticated;
grant select, insert, update, delete on public.omg_store_profit_daily_snapshots to authenticated;
grant select, insert, update, delete on public.omg_store_commission_months to authenticated;
revoke all on public.omg_profit_sync_runs from anon;
revoke all on public.omg_store_profit_daily_snapshots from anon;
revoke all on public.omg_store_commission_months from anon;

comment on table public.omg_store_profit_daily_snapshots is
  'Nightly rolling current-month OMG profit audit by mapped store code.';
comment on table public.omg_store_commission_months is
  'One idempotent OMG store closeout per calendar month. Finalized rows are the commission system of record.';
