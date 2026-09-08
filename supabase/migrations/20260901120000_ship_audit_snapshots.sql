-- ship_audit_snapshots — history for the shipping cost audit.
--
-- The shipping audit (SHIPPING_COST_HANDOFF.md) was originally a one-time
-- snapshot pasted into a document. Its headline finding is a recording gap:
-- ~91% of sales orders carry a shipping charge but no actual shipping cost,
-- so they cannot be scored. A single number cannot show whether that gap is
-- closing — which is the only thing anyone actually wants to know once the
-- ShipStation backfill starts. This table is that history.
--
-- One row per capture day, written by scripts/shipping-audit.js (which also
-- rewrites the generated blocks of the handoff doc). Idempotent per day, so
-- re-running the script restates today's row instead of piling up duplicates.
create table if not exists public.ship_audit_snapshots (
  id               bigserial primary key,
  captured_on      date not null default current_date,
  total_sos        integer not null default 0,  -- sales orders in the window
  sos_with_charge  integer not null default 0,  -- carrying a shipping charge
  sos_with_cost    integer not null default 0,  -- with a recorded actual cost
  charged_total    numeric not null default 0,  -- $ charged, scoreable orders only
  cost_total       numeric not null default 0,  -- $ actual outbound cost
  margin_pct       numeric,                     -- null when nothing is scoreable
  losing_sos       integer not null default 0,  -- scored orders where cost > charge
  inbound_freight  numeric not null default 0,  -- _inbound_freight on the same orders
  window_start     date,                        -- parsed from sales_orders.created_at (TEXT)
  window_end       date,
  unparsed_dates   integer not null default 0,  -- rows whose created_at would not parse
  created_at       timestamptz not null default now(),
  unique (captured_on)
);

create index if not exists ship_audit_snapshots_captured_idx
  on public.ship_audit_snapshots (captured_on desc);

alter table public.ship_audit_snapshots enable row level security;

-- Cost and margin data is sensitive: active staff only from the browser
-- (mirrors finance_snapshots). The audit script connects with a service-role
-- or direct Postgres credential, which bypasses RLS.
drop policy if exists ship_audit_snapshots_staff_all on public.ship_audit_snapshots;
create policy ship_audit_snapshots_staff_all
  on public.ship_audit_snapshots
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
