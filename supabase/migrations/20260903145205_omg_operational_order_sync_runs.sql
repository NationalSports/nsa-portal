-- Audit trail for the safe nightly OMG operational refresh. This job only
-- updates order-count metadata on omg_stores; accounting and commission
-- snapshots continue to come exclusively from the monthly Margin Report.
create table if not exists public.omg_operational_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'complete', 'partial', 'failed')),
  stores_requested integer not null default 0,
  stores_synced integer not null default 0,
  stores_held integer not null default 0,
  orders_seen integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists omg_operational_sync_runs_started_at_idx
  on public.omg_operational_sync_runs (started_at desc);

alter table public.omg_operational_sync_runs enable row level security;
revoke all on table public.omg_operational_sync_runs from anon, authenticated;
grant all on table public.omg_operational_sync_runs to service_role;

comment on table public.omg_operational_sync_runs is
  'Service-only audit log for operational OMG order-count refreshes. Never used for commissions.';
