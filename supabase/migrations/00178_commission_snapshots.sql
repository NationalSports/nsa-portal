-- commission_snapshots — freeze each PAID invoice's commission at the numbers that were
-- true when it was earned.
--
-- Why this exists: commissions were 100% derived at render time (CommissionsPage calcGP /
-- buildCommLines over live invoice + SO state). That meant any later edit to the SO —
-- a corrected PO cost, an added freight charge, a re-priced line — retroactively changed
-- an already-paid invoice's earned commission and could move it between monthly
-- statements. Reps and accounting need a statement that stops moving once it's paid.
--
-- Shape: one row per paid invoice, written by the client the first time the Commissions
-- page sees a fully-hydrated paid line without a snapshot (insert-only via upsert
-- ignoreDuplicates — concurrent mounts can't clobber each other's freeze). Admin rate
-- overrides update rate/amount/override in place; an explicit admin "Re-freeze" recomputes
-- from live data after a deliberate correction. Partial invoices are NOT snapshotted —
-- they still change (final payment date isn't known) and keep rendering live.
create table if not exists public.commission_snapshots (
  invoice_id  text primary key,           -- e.g. 'INV-1234'
  so_id       text,
  customer_id text,
  rep_id      text,                       -- commissionRepId at snapshot time (informational —
                                          -- statement attribution stays live per businessLogic.js)
  gp          jsonb not null,             -- calcGP output {rev,cost,gp,shipRev,shipCost,inboundFreight}
  rate        numeric not null,           -- decimal, e.g. 0.30
  amount      numeric not null,           -- frozen commission dollars
  paid_date   date,                       -- last payment date (statement month keys off this)
  days_to_pay integer,
  override    jsonb,                      -- {value:true|<decimal>} when an admin override was active
  snapped_by  text,
  snapped_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists commission_snapshots_rep_idx  on public.commission_snapshots (rep_id);
create index if not exists commission_snapshots_paid_idx on public.commission_snapshots (paid_date);

alter table public.commission_snapshots enable row level security;

-- Commission data is sensitive: only active staff may read/write from the browser.
-- Mirrors the supplier_bill_holds staff gate (team_members.auth_id = auth.uid()).
drop policy if exists commission_snapshots_staff_all on public.commission_snapshots;
create policy commission_snapshots_staff_all
  on public.commission_snapshots
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
