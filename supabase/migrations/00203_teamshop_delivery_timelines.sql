-- Team Shop delivery-timeline estimates — staff-editable rule rows.
--
-- Owner: shoppers should see a realistic "ships in ~X weeks" estimate that
-- depends on where the blanks come from, and staff must be able to edit every
-- band later from the Team Shop Settings page without a code change ("this is
-- all in settings"). So the rules live as ROWS, not code:
--
--   rule_type = 'in_stock' — applies when NSA's own warehouse stock
--               (product_inventory) covers the ENTIRE line. Highest precedence.
--   rule_type = 'source'   — matched by products.inventory_source against the
--               row's inventory_sources array (the same vocabulary
--               inventory_unified / 00202's auto-PO settings use: sanmar, nike,
--               ss_activewear, click, ua, agron, momentec, richardson, ...).
--   rule_type = 'deco'     — a decoration-type override (deco_type is the
--               CONCRETE production type, 00198 vocabulary). Applied as
--               max(): min = max(band.min, deco.min), max = max(band.max,
--               deco.max) — a deco override can only LENGTHEN an estimate,
--               never shorten it (adidas 3 weeks + screen print stays 3 weeks).
--
-- Resolution (netlify/functions/_teamshopTimeline.js, service role):
--   in-stock check → source band → apply deco override(s) as max().
-- A line whose source matches no active row gets NO estimate (null), and the
-- order-level estimate is the SLOWEST line (null if any line is unknown —
-- never promise a date the rules can't back).
--
-- The estimate is DISPLAY METADATA ONLY: never money, never part of the quote
-- hash, and the browser never computes it — teamshop-public-price.js /
-- quickorder-quote.js return the resolved band alongside prices.
--
-- RLS: staff SELECT + staff INSERT/UPDATE via public.is_team_member(), exactly
-- like 00198 teamshop_deco_rates — the Settings section edits rows with the
-- staff JWT. No anon access on purpose: shoppers only ever see the estimate
-- through the pricing functions (service role bypasses RLS), same posture as
-- the rate card. No DELETE policy — retire a rule with active = false.

create table if not exists public.teamshop_delivery_timelines (
  id                uuid primary key default gen_random_uuid(),
  rule_key          text not null unique,          -- stable machine key (seeded below)
  rule_type         text not null,                 -- 'in_stock' | 'source' | 'deco'
  inventory_sources text[] not null default '{}',  -- 'source' rows: products.inventory_source values
  deco_type         text,                          -- 'deco' rows: concrete production type (00198)
  min_weeks         numeric not null,
  max_weeks         numeric not null,
  label             text not null,                 -- band text the storefront shows verbatim (e.g. '~1.5–2 weeks')
  sort_order        int not null default 0,        -- match order for 'source' rows + settings display order
  active            boolean not null default true,
  notes             text,                          -- staff-facing context (assumption flags live here)
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  constraint teamshop_delivery_timelines_band_valid check (min_weeks >= 0 and max_weeks >= min_weeks),
  constraint teamshop_delivery_timelines_rule_type check (rule_type in ('in_stock', 'source', 'deco'))
);

alter table public.teamshop_delivery_timelines enable row level security;

drop policy if exists teamshop_delivery_timelines_staff_read on public.teamshop_delivery_timelines;
create policy teamshop_delivery_timelines_staff_read on public.teamshop_delivery_timelines
  for select to authenticated using (public.is_team_member());

drop policy if exists teamshop_delivery_timelines_staff_insert on public.teamshop_delivery_timelines;
create policy teamshop_delivery_timelines_staff_insert on public.teamshop_delivery_timelines
  for insert to authenticated with check (public.is_team_member());

drop policy if exists teamshop_delivery_timelines_staff_update on public.teamshop_delivery_timelines;
create policy teamshop_delivery_timelines_staff_update on public.teamshop_delivery_timelines
  for update to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

-- No anon access at all — estimates are served only through the functions.
revoke select, insert, update, delete on public.teamshop_delivery_timelines from anon;

-- ── Seed (owner's numbers, 2026-07 — every band staff-editable later) ────────
-- on conflict do nothing: re-running never clobbers staff edits.
--   * in_stock: NSA warehouse stock covers the full line → ~1 week.
--   * sanmar/nike/ss_activewear: SanMar / S&S blanks → ~1.5–2 weeks
--     (nike inventory syncs FROM SanMar, see 00202's mapping notes).
--   * momentec/richardson: ~2 weeks — the owner did NOT specify this band;
--     seeded as an editable assumption (flagged in notes).
--   * click/ua/agron: adidas CLICK / UA ArmourHouse ~3-week lead (00202);
--     agron (adidas accessories) grouped with adidas — editable assumption.
--   * screen_print deco override: ~2–3 weeks, applied as max() — it never
--     shortens a band (adidas/UA + screen print stays ~3 weeks).
insert into public.teamshop_delivery_timelines
  (rule_key, rule_type, inventory_sources, deco_type, min_weeks, max_weeks, label, sort_order, notes) values
  ('in_stock',                  'in_stock', '{}',                          null,           1,   1, '~1 week',        0,  'NSA warehouse stock covers the full line'),
  ('source_sanmar_ss',          'source',   '{sanmar,nike,ss_activewear}', null,           1.5, 2, '~1.5–2 weeks',  10,  'SanMar / S&S Activewear blanks (nike syncs from SanMar)'),
  ('source_momentec_richardson','source',   '{momentec,richardson}',       null,           2,   2, '~2 weeks',      20,  'Owner did not specify this band — editable assumption'),
  ('source_adidas_ua',          'source',   '{click,ua,agron}',            null,           3,   3, '~3 weeks',      30,  'adidas CLICK / UA ArmourHouse (~3-week lead); agron grouped with adidas — editable assumption'),
  ('deco_screen_print',         'deco',     '{}',                          'screen_print', 2,   3, '~2–3 weeks',    40,  'Applied as max() over the source band — never shortens an estimate')
on conflict (rule_key) do nothing;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_delivery_timelines;
