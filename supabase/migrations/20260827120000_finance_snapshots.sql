-- finance_snapshots — periodic freeze of the admin Financials model.
--
-- Two jobs, one table:
--   1) Forecast accuracy. Each row stores the revenue forecast that was made
--      FOR a target month AS OF a given date. Later, actuals are compared to it
--      so the model's track record is visible before anyone leans on it.
--   2) Feeds the weekly email digest the margin/order-book figures it cannot
--      compute itself (those need the client's pricing engine, which does not
--      run in a Netlify function). Billed/AR figures the digest reads live.
--
-- Written by the Financials page (admin) — idempotent per (as_of_month, target_month),
-- so revisiting the page re-states the current month's snapshot rather than piling up rows.
create table if not exists public.finance_snapshots (
  id            bigserial primary key,
  as_of_month   text not null,              -- 'YYYY-MM' the forecast was made in
  as_of_date    date not null,              -- exact day the snapshot was taken
  target_month  text not null,              -- 'YYYY-MM' the forecast is FOR
  horizon       integer not null default 0, -- months ahead (0 = current month)
  committed     numeric not null default 0, -- order-book billing scheduled into target_month
  new_business  numeric not null default 0, -- expected new orders
  base          numeric not null default 0, -- committed + new_business (the headline forecast)
  low           numeric not null default 0,
  high          numeric not null default 0,
  kpis          jsonb,                      -- {arTotal,ar60plus,backlogValue,backlogGp,wip,ytdRev,ytdGp}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (as_of_month, target_month)
);

create index if not exists finance_snapshots_target_idx on public.finance_snapshots (target_month);
create index if not exists finance_snapshots_asof_idx   on public.finance_snapshots (as_of_date desc);

alter table public.finance_snapshots enable row level security;

-- Financial data is sensitive: only active staff may read/write from the browser
-- (mirrors the commission_snapshots staff gate). The weekly digest reads with the
-- service-role key, which bypasses RLS.
drop policy if exists finance_snapshots_staff_all on public.finance_snapshots;
create policy finance_snapshots_staff_all
  on public.finance_snapshots
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
