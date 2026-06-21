-- ════════════════════════════════════════════════════════════════════
-- Migration 00117 — Agron inventory + unified inventory view
--
-- Adds Agron (adidas accessories distributed by Agron B2B — socks, bags,
-- headwear, underwear, sport accessories, knit caps) to the portal using the
-- SAME /adidas catalog UI as adidas CLICK. Agron products are brand='Adidas'
-- with inventory_source='agron'; their per-size stock lives in a new
-- agron_inventory table that mirrors adidas_inventory, and the /adidas catalog
-- reads both through inventory_unified.
--
-- Agron SKUs are the numeric Agron colorway codes (e.g. 5159078); multi-size
-- items carry a per-size suffix on the portal (…B/C/D). They do NOT overlap the
-- adidas CLICK SKUs, so the union is a clean by-SKU join.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- Idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
-- ════════════════════════════════════════════════════════════════════

-- 1) agron_inventory — same shape as the LIVE adidas_inventory (text id =
--    `${sku}-${size}`, source, created_at) plus per-size upc / size_code extras.
create table if not exists public.agron_inventory (
  id                    text primary key,            -- `${sku}-${size}`
  sku                   text not null,               -- numeric Agron colorway code (e.g. 5159078)
  size                  text not null,               -- size label (OSFA, S, M, L, XL, …)
  stock_qty             integer not null default 0,
  future_delivery_date  text,                        -- at-once catalog = null (prebook later)
  future_delivery_qty   integer,
  last_synced           timestamptz default now(),
  source                text default 'agron_b2b',
  created_at            timestamptz default now(),
  upc                   text,                        -- per-size UPC (Agron stock_shipments join key)
  size_code             text,                        -- per-size Agron SKU incl. B/C/D suffix (e.g. 5159078B)
  unique (sku, size)
);
create index if not exists agron_inventory_sku_idx on public.agron_inventory (sku);

-- 2) RLS — mirror adidas_inventory exactly (anon read + anon/all write; the
--    COWORK sync upserts with the anon key, same as the adidas sync).
alter table public.agron_inventory enable row level security;
drop policy if exists "Allow all access to agron_inventory" on public.agron_inventory;
drop policy if exists "agron_inventory_anon_read"          on public.agron_inventory;
drop policy if exists "agron_inventory_anon_write"         on public.agron_inventory;
create policy "Allow all access to agron_inventory" on public.agron_inventory for all    using (true) with check (true);
create policy "agron_inventory_anon_read"           on public.agron_inventory for select using (true);
create policy "agron_inventory_anon_write"          on public.agron_inventory for all    using (true) with check (true);

-- 3) products discriminator — preferred per spec. Default 'click' (existing CLICK
--    catalog); flip the Agron-vendor rows to 'agron'. Also normalize the stray
--    brand='Agron' rows to 'Adidas' so they flow into the brand~adidas catalog query.
alter table public.products add column if not exists inventory_source text default 'click';
update public.products set inventory_source = 'agron'
  where vendor_id = 'v1777312659133' and inventory_source is distinct from 'agron';
update public.products set brand = 'Adidas'
  where vendor_id = 'v1777312659133' and brand = 'Agron';

-- 4) inventory_unified — drop-in union the /adidas UI reads instead of
--    adidas_inventory. `id` is globally unique (CLICK & Agron SKUs are disjoint),
--    so the UI's range pagination (.order('id')) is unchanged.
create or replace view public.inventory_unified as
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'click'::text as source
    from public.adidas_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'agron'::text as source
    from public.agron_inventory;

grant select on public.inventory_unified to anon, authenticated, service_role;
