-- ════════════════════════════════════════════════════════════════════
-- Migration 00120 — Under Armour + Nike live B2B inventory
--
-- Extends the same pattern adidas CLICK / Agron use (per-vendor *_inventory
-- tables unioned into inventory_unified, which the /adidas live-look catalog and
-- the order screen read) to two more brands:
--
--   • Under Armour — synced from UA's Armour House B2B (armourhouse.underarmour.com)
--     by the COWORK bot (anon key, like the adidas Cowork sync) AND from S&S
--     Activewear (ss-ua-sync-background, service role) for the UA gear S&S carries.
--     UA is already a first-class brand here (vendor v2, adidas_ua_tier pricing,
--     ~2,239 products) — this just adds its live stock.
--
--   • Nike — synced from SanMar (sanmar-nike-sync-background, service role) for the
--     Nike gear SanMar carries. Nike on the ORDER screen also flows through the
--     existing live SanMar vendor-inventory path; nike_inventory is what lets the
--     public catalog (which only reads the synced union view) show it too.
--
-- SKUs are disjoint across brands (adidas alphanumeric IQ2728; Agron 51xxxxx;
-- UA 12–14xxxxx; Nike SanMar styles like NKDC1990), so inventory_unified stays a
-- clean by-SKU union with a `source` discriminator and a globally-unique `id`.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- Idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) ua_inventory — same shape as adidas_inventory/agron_inventory ───
create table if not exists public.ua_inventory (
  id                    text primary key,            -- `${sku}-${size}`
  sku                   text not null,               -- UA style/colorway code (e.g. 1370399-001) or S&S style-color
  size                  text not null,               -- size label (S, M, L, XL, 2XL, OSFA, …)
  stock_qty             integer not null default 0,
  future_delivery_date  text,                        -- next inbound date (Armour House); null on S&S at-once
  future_delivery_qty   integer,                     -- projected ATP for that date
  last_synced           timestamptz default now(),
  source                text default 'armourhouse',  -- 'armourhouse' (UA B2B) | 'ss_activewear'
  created_at            timestamptz default now(),
  style_number          text,                        -- UA base style (shared across colorways), traceability
  color_code            text,                        -- UA colorway code
  upc                   text,                        -- per-size UPC, traceability
  unique (sku, size)
);
create index if not exists ua_inventory_sku_idx on public.ua_inventory (sku);

-- ─── 2) nike_inventory — same shape, SanMar-sourced ───
create table if not exists public.nike_inventory (
  id                    text primary key,            -- `${sku}-${size}`
  sku                   text not null,               -- Nike style-color SKU (SanMar)
  size                  text not null,
  stock_qty             integer not null default 0,
  future_delivery_date  text,
  future_delivery_qty   integer,
  last_synced           timestamptz default now(),
  source                text default 'sanmar',       -- 'sanmar'
  created_at            timestamptz default now(),
  style_number          text,                        -- SanMar style id
  color_code            text,                        -- SanMar color code
  gtin                  text,                        -- per-size GTIN/UPC, traceability
  unique (sku, size)
);
create index if not exists nike_inventory_sku_idx on public.nike_inventory (sku);

-- ─── 3) RLS — mirror adidas_inventory/agron_inventory (anon read + anon/all write;
--          the COWORK sync and the netlify service-role syncs both upsert here) ───
alter table public.ua_inventory   enable row level security;
alter table public.nike_inventory enable row level security;
drop policy if exists "ua_inventory_all"          on public.ua_inventory;
drop policy if exists "ua_inventory_anon_read"    on public.ua_inventory;
drop policy if exists "ua_inventory_anon_write"   on public.ua_inventory;
drop policy if exists "nike_inventory_all"        on public.nike_inventory;
drop policy if exists "nike_inventory_anon_read"  on public.nike_inventory;
drop policy if exists "nike_inventory_anon_write" on public.nike_inventory;
create policy "ua_inventory_all"          on public.ua_inventory   for all    using (true) with check (true);
create policy "ua_inventory_anon_read"    on public.ua_inventory   for select using (true);
create policy "ua_inventory_anon_write"   on public.ua_inventory   for all    using (true) with check (true);
create policy "nike_inventory_all"        on public.nike_inventory for all    using (true) with check (true);
create policy "nike_inventory_anon_read"  on public.nike_inventory for select using (true);
create policy "nike_inventory_anon_write" on public.nike_inventory for all    using (true) with check (true);

-- ─── 4) products discriminator — tag existing brand rows so promote/idempotency
--          and any per-source logic can find them. Display gates on brand, not
--          this column, so it's metadata-only (mirrors migration 00117's agron tag). ───
alter table public.products add column if not exists inventory_source text default 'click';
update public.products set inventory_source = 'ua'
  where brand ilike 'under armour' and inventory_source is distinct from 'ua';
update public.products set inventory_source = 'nike'
  where brand ilike 'nike' and inventory_source is distinct from 'nike';

-- ─── 5) inventory_unified — the union the /adidas live-look + order screen read.
--          `id` stays globally unique across brands (SKUs are disjoint). ───
create or replace view public.inventory_unified as
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'click'::text as source
    from public.adidas_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'agron'::text as source
    from public.agron_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'ua'::text as source
    from public.ua_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'nike'::text as source
    from public.nike_inventory;

grant select on public.inventory_unified to anon, authenticated, service_role;

-- ─── 6) ua_products_staging — Armour House discovery handoff (mirror agron 00118).
--          COWORK (anon key) writes per-style metadata; Claude Code / service role
--          promotes it into products. The S&S-sourced UA sync writes products
--          directly (service role) and needs no staging. ───
create table if not exists public.ua_products_staging (
  sku             text primary key,   -- UA style/colorway code (= ua_inventory.sku)
  style_number    text,
  name            text,
  color           text,
  product_type    text,               -- UA category label (raw) → mapped below
  gender          text,
  retail_price    numeric,            -- UA MSRP
  image_url       text,
  description      text,
  sizes           jsonb,              -- optional; promote prefers live ua_inventory sizes
  is_active       boolean default true,
  last_synced     timestamptz default now(),
  source          text default 'armourhouse'
);
alter table public.ua_products_staging enable row level security;
drop policy if exists "ua_products_staging_all"       on public.ua_products_staging;
drop policy if exists "ua_products_staging_anon_read" on public.ua_products_staging;
create policy "ua_products_staging_all"       on public.ua_products_staging for all    using (true) with check (true);
create policy "ua_products_staging_anon_read" on public.ua_products_staging for select using (true);

-- Category map: UA product type → portal category (grow as new types appear).
create or replace function public._ua_map_category(p_type text)
returns text language sql immutable as $map$
  select case
    when lower(coalesce(p_type,'')) ~ 'polo'                       then 'Polos'
    when lower(coalesce(p_type,'')) ~ '1/4|quarter[- ]?zip'       then '1/4 Zips'
    when lower(coalesce(p_type,'')) ~ 'jacket|vest|outer|wind|rain' then 'Outerwear'
    when lower(coalesce(p_type,'')) ~ 'hood|fleece|sweatshirt|pullover' then 'Hoods'
    when lower(coalesce(p_type,'')) ~ 'crew'                       then 'Crew'
    when lower(coalesce(p_type,'')) ~ 'short'                      then 'Shorts'
    when lower(coalesce(p_type,'')) ~ 'pant|legging|jogger|bottom|tight' then 'Pants'
    when lower(coalesce(p_type,'')) ~ 'tee|t-shirt|active'         then 'Tees'
    when lower(coalesce(p_type,'')) ~ 'hat|cap|beanie|visor|headwear' then 'Hats'
    when lower(coalesce(p_type,'')) ~ 'bag|backpack|duffel|sack'   then 'Bags'
    when lower(coalesce(p_type,'')) ~ 'sock'                       then 'Socks'
    when lower(coalesce(p_type,'')) ~ 'glove|accessor|towel|sleeve' then 'Accessories'
    when lower(coalesce(p_type,'')) ~ 'jersey|top'                 then 'Jersey'
    else 'Other' end
$map$;

-- Promote staging → products. SECURITY INVOKER: only a role that can write
-- products effectively runs it (so the anon bot fills staging but can't mutate
-- products). Idempotent: fill-empties on existing rows, create-if-missing
-- otherwise. UA DIRECT (Armour House) cost basis is retail × 0.5 × 0.85 =
-- retail × 0.425 (NOT the 0.375 adidas/Agron rule); UA still sells at the
-- adidas_ua_tier discount off retail. (S&S-sourced UA priced separately in the
-- ss-ua sync: nsa_cost = S&S wholesale, catalog_sell_price = cost × 1.65.)
-- Returns (created, updated).
create or replace function public.promote_ua_products_from_staging()
returns table(created integer, updated integer)
language plpgsql
as $func$
declare v_created integer := 0; v_updated integer := 0;
begin
  with upd as (
    update public.products p set
      category         = coalesce(p.category, public._ua_map_category(s.product_type)),
      retail_price     = coalesce(p.retail_price, s.retail_price),
      nsa_cost         = coalesce(p.nsa_cost, round(coalesce(s.retail_price,0) * 0.425, 2)),  -- retail × 0.5 × 0.85
      image_front_url  = coalesce(nullif(p.image_front_url,''), s.image_url),
      description      = coalesce(nullif(p.description,''), s.description),
      inventory_source = 'ua',
      is_active        = coalesce(s.is_active, true),
      is_archived      = false,
      updated_at       = now()
    from public.ua_products_staging s
    where p.sku = s.sku and p.brand ilike 'under armour'
    returning 1
  ) select count(*) into v_updated from upd;

  with ins as (
    insert into public.products
      (id, sku, name, brand, vendor_id, color, category, retail_price, nsa_cost,
       available_sizes, image_front_url, description, is_active, is_archived, inventory_source)
    select 'p-ua-'||s.sku, s.sku, s.name, 'Under Armour', 'v2', s.color,
       public._ua_map_category(s.product_type),
       s.retail_price, round(coalesce(s.retail_price,0) * 0.425, 2),  -- retail × 0.5 × 0.85
       coalesce((select to_jsonb(array_agg(distinct ui.size order by ui.size))
                   from public.ua_inventory ui where ui.sku = s.sku),
                s.sizes, '[]'::jsonb),
       s.image_url, s.description,
       coalesce(s.is_active, true), false, 'ua'
    from public.ua_products_staging s
    where not exists (
      select 1 from public.products p where p.sku = s.sku and p.brand ilike 'under armour')
    returning 1
  ) select count(*) into v_created from ins;

  return query select v_created, v_updated;
end
$func$;
