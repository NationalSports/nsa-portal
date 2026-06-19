-- ════════════════════════════════════════════════════════════════════
-- Migration 00127 — Vendor catalog expansion (Richardson, Momentec,
--                   SanMar non-Nike brands, S&S non-Adidas/UA brands)
--
-- Extends the inventory_unified view pattern to four more sources so the
-- /adidas live-look catalog can show Richardson Sports, Momentec Brands,
-- and selected brands from SanMar and S&S Activewear alongside the existing
-- Adidas / UA / Nike / Agron feeds.
--
-- New sources and their sync functions:
--   richardson_inventory  ← richardson-sync-background  (Richardson stock feed)
--   momentec_inventory    ← momentec-sync-background    (Momentec HCL Commerce)
--   sanmar_inventory      ← sanmar-brands-sync-background (Port Authority,
--                           Sport-Tek, District, Bella+Canvas via SanMar SOAP)
--   ss_inventory          ← ss-brands-sync-background   (Port Authority,
--                           Sport-Tek, District, Bella+Canvas, Boxercraft,
--                           Gildan via S&S REST API)
--
-- SKUs are namespaced by sync (rich-*, mt-*, smb-*, ssb-*) so all four tables
-- can coexist in inventory_unified without id collisions.
-- Idempotent (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) richardson_inventory ────────────────────────────────────────
create table if not exists public.richardson_inventory (
  id                    text primary key,            -- `{sku}-{size}`
  sku                   text not null,               -- e.g. "112-SolidBlack"
  size                  text not null,               -- "S/M", "OSFA", …
  stock_qty             integer not null default 0,
  future_delivery_date  text,                        -- YYYY-MM-DD; null when no restock date
  future_delivery_qty   integer,                     -- not provided by Richardson feed → null
  last_synced           timestamptz default now(),
  source                text default 'richardson',
  created_at            timestamptz default now(),
  style_number          text,
  color_code            text,
  upc                   text,
  unique (sku, size)
);
create index if not exists richardson_inventory_sku_idx on public.richardson_inventory (sku);

-- ─── 2) momentec_inventory ──────────────────────────────────────────
create table if not exists public.momentec_inventory (
  id                    text primary key,            -- `{sku}-{size}`
  sku                   text not null,
  size                  text not null,
  stock_qty             integer not null default 0,
  future_delivery_date  text,
  future_delivery_qty   integer,
  last_synced           timestamptz default now(),
  source                text default 'momentec',
  created_at            timestamptz default now(),
  unique (sku, size)
);
create index if not exists momentec_inventory_sku_idx on public.momentec_inventory (sku);

-- ─── 3) sanmar_inventory — Port Authority / Sport-Tek / District / Bella+Canvas
create table if not exists public.sanmar_inventory (
  id                    text primary key,            -- `{sku}-{size}`
  sku                   text not null,
  size                  text not null,
  stock_qty             integer not null default 0,
  future_delivery_date  text,
  future_delivery_qty   integer,
  last_synced           timestamptz default now(),
  source                text default 'sanmar',
  created_at            timestamptz default now(),
  style_number          text,
  color_code            text,
  unique (sku, size)
);
create index if not exists sanmar_inventory_sku_idx on public.sanmar_inventory (sku);

-- ─── 4) ss_inventory — Port Authority / Sport-Tek / District / Bella+Canvas /
--                       Boxercraft / Gildan from S&S Activewear
create table if not exists public.ss_inventory (
  id                    text primary key,            -- `{sku}-{size}`
  sku                   text not null,
  size                  text not null,
  stock_qty             integer not null default 0,
  future_delivery_date  text,
  future_delivery_qty   integer,
  last_synced           timestamptz default now(),
  source                text default 'ss_activewear',
  created_at            timestamptz default now(),
  unique (sku, size)
);
create index if not exists ss_inventory_sku_idx on public.ss_inventory (sku);

-- ─── 5) RLS — mirror the existing *_inventory tables (anon read + all write) ───
alter table public.richardson_inventory enable row level security;
alter table public.momentec_inventory   enable row level security;
alter table public.sanmar_inventory     enable row level security;
alter table public.ss_inventory         enable row level security;

drop policy if exists "richardson_inventory_all"   on public.richardson_inventory;
drop policy if exists "richardson_inventory_read"  on public.richardson_inventory;
drop policy if exists "momentec_inventory_all"     on public.momentec_inventory;
drop policy if exists "momentec_inventory_read"    on public.momentec_inventory;
drop policy if exists "sanmar_inventory_all"       on public.sanmar_inventory;
drop policy if exists "sanmar_inventory_read"      on public.sanmar_inventory;
drop policy if exists "ss_inventory_all"           on public.ss_inventory;
drop policy if exists "ss_inventory_read"          on public.ss_inventory;

create policy "richardson_inventory_all"  on public.richardson_inventory for all    using (true) with check (true);
create policy "richardson_inventory_read" on public.richardson_inventory for select using (true);
create policy "momentec_inventory_all"    on public.momentec_inventory   for all    using (true) with check (true);
create policy "momentec_inventory_read"   on public.momentec_inventory   for select using (true);
create policy "sanmar_inventory_all"      on public.sanmar_inventory     for all    using (true) with check (true);
create policy "sanmar_inventory_read"     on public.sanmar_inventory     for select using (true);
create policy "ss_inventory_all"          on public.ss_inventory         for all    using (true) with check (true);
create policy "ss_inventory_read"         on public.ss_inventory         for select using (true);

-- ─── 6) inventory_unified — extend the view to include all four new tables ───
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
    from public.nike_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'richardson'::text as source
    from public.richardson_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'momentec'::text as source
    from public.momentec_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'sanmar'::text as source
    from public.sanmar_inventory
  union all
  select id, sku, size, stock_qty, future_delivery_date, future_delivery_qty,
         last_synced, 'ss_activewear'::text as source
    from public.ss_inventory;

grant select on public.inventory_unified to anon, authenticated, service_role;
grant all    on public.richardson_inventory to anon, authenticated, service_role;
grant all    on public.momentec_inventory   to anon, authenticated, service_role;
grant all    on public.sanmar_inventory     to anon, authenticated, service_role;
grant all    on public.ss_inventory         to anon, authenticated, service_role;
