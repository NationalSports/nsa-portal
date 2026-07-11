-- Team Shop decoration rate card (Coach Crossover Workstream 2).
--
-- Owner-approved taxonomy: the storefront offers three METHOD FAMILIES —
-- Embroidery, Heat Applications, Screen Print (24-piece minimum). Heat
-- Applications is a FAMILY with multiple kinds (DTF, Vinyl, Silicone Patch —
-- extensible by adding rows). DTF is now a KIND of heat application, not a
-- top-level method.
--
--   family = STOREFRONT GROUPING ONLY ('embroidery' | 'heat' | 'screen_print').
--            It shapes the builder's method tiles and never routes production.
--   type   = the CONCRETE PRODUCTION IDENTITY ('embroidery' | 'dtf' | 'vinyl' |
--            'silicone_patch' | 'screen_print'). This is what flows into cart
--            lines → webstore_order_items.decorations jsonb → 00192's
--            so_item_decorations/so_jobs, so a DTF job routes to the DTF
--            printer and a vinyl job to the cutter. Never collapse types into
--            their family.
--   option_key = a sub-option within a type (e.g. vinyl 'number',
--            'name_number'); 'standard' is the plain rate.
--
-- Every row is staff-editable later (a settings UI is a separate follow-up
-- build); the storefront prices exclusively through the service-role Netlify
-- functions (netlify/functions/_teamshopRates.js), which fall back to the
-- legacy decoPricing.dP tables until this migration is applied.
--
-- RLS: staff SELECT + staff INSERT/UPDATE via public.is_team_member() (00173
-- predicate, reused verbatim by 00189/00190) — staff WILL edit rates from the
-- future settings page with their own JWT. No anon/coach policies on purpose:
-- shoppers only ever see prices through the pricing functions (service role
-- bypasses RLS). No DELETE policy — retire a rate with active = false.

create table if not exists public.teamshop_deco_rates (
  id         uuid primary key default gen_random_uuid(),
  family     text not null,                     -- 'embroidery' | 'heat' | 'screen_print' (storefront grouping)
  type       text not null,                     -- concrete production type: 'embroidery' | 'dtf' | 'vinyl' | 'silicone_patch' | 'screen_print'
  option_key text not null default 'standard',  -- sub-option within a type (e.g. 'number', 'name_number')
  label      text not null,
  price      numeric not null,                  -- flat per-piece sell price
  cost       numeric,                           -- staff-set cost basis for GP/commissions (nullable until set)
  min_qty    int not null default 1,            -- minimum line quantity (screen print = 24)
  sort_order int not null default 0,
  active     boolean not null default true,
  unique (type, option_key)
);

alter table public.teamshop_deco_rates enable row level security;

-- Staff read + write (INSERT/UPDATE only — no delete; deactivate instead).
drop policy if exists teamshop_deco_rates_staff_read on public.teamshop_deco_rates;
create policy teamshop_deco_rates_staff_read on public.teamshop_deco_rates
  for select to authenticated using (public.is_team_member());

drop policy if exists teamshop_deco_rates_staff_insert on public.teamshop_deco_rates;
create policy teamshop_deco_rates_staff_insert on public.teamshop_deco_rates
  for insert to authenticated with check (public.is_team_member());

drop policy if exists teamshop_deco_rates_staff_update on public.teamshop_deco_rates;
create policy teamshop_deco_rates_staff_update on public.teamshop_deco_rates
  for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

-- No anon access at all — pricing is served only through the functions.
revoke select, insert, update, delete on public.teamshop_deco_rates from anon;

-- ── Seed rates (launch defaults — all staff-editable later) ─────────────────
-- on conflict do nothing: re-running this migration never clobbers staff edits.
insert into public.teamshop_deco_rates (family, type, option_key, label, price, min_qty, sort_order) values
  ('embroidery',   'embroidery',     'standard',    'Embroidery',             8.00, 1,  0),
  ('heat',         'dtf',            'standard',    'DTF Transfer',           6.00, 1,  10),
  ('heat',         'vinyl',          'standard',    'Vinyl',                  5.00, 1,  20),
  ('heat',         'vinyl',          'number',      'Player number (vinyl)',  4.00, 1,  21),
  ('heat',         'vinyl',          'name_number', 'Name + number (vinyl)',  7.00, 1,  22),
  ('heat',         'silicone_patch', 'standard',    'Silicone patch',         9.00, 1,  30),
  ('screen_print', 'screen_print',   'standard',    'Screen print',           5.00, 24, 40)
on conflict (type, option_key) do nothing;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_deco_rates;
