-- ship_cost_basis — the calibration behind the order editor's shipping suggestion.
--
-- One row, recomputed by scripts/shipping-audit.js on every run. The suggestion
-- in the order editor reads it rather than carrying hardcoded constants, which
-- is the whole point: as more orders get a recorded cost the numbers here move,
-- and the suggestion gets better without anyone editing code.
--
-- Honesty about what this can do. Across the orders with a recorded cost, cost
-- correlates only ~0.5 with both unit count and merchandise value, and the
-- middle half of orders spans 2.3%-9.1% of merch. Shipping cost genuinely is
-- not well predicted by anything known at quote time — that is the audit's
-- central finding, not a modelling failure. So the editor shows the sample size
-- and the range beside the number, and the number is a starting point rather
-- than an answer.
create table if not exists public.ship_cost_basis (
  id                    boolean primary key default true,  -- single row
  sample_n              integer not null default 0,
  median_cost_per_unit  numeric,
  median_cost_pct_merch numeric,   -- percent, e.g. 3.86
  p25_cost_pct_merch    numeric,
  p75_cost_pct_merch    numeric,
  median_cost           numeric,
  target_margin_pct     numeric not null default 15,  -- the 10-15% goal in the handoff
  window_start          date,
  window_end            date,
  updated_at            timestamptz not null default now(),
  constraint ship_cost_basis_single_row check (id)
);

comment on table public.ship_cost_basis is
  'Single-row shipping cost calibration, refreshed by scripts/shipping-audit.js. Read by the order editor to suggest a shipping charge.';

alter table public.ship_cost_basis enable row level security;

-- Readable by any signed-in staff member (the editor needs it); writes come from
-- the audit job, which uses a service-role or direct Postgres credential.
drop policy if exists ship_cost_basis_staff_read on public.ship_cost_basis;
create policy ship_cost_basis_staff_read on public.ship_cost_basis for select to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
