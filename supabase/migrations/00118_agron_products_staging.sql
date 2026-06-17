-- ════════════════════════════════════════════════════════════════════
-- Migration 00118 — Agron product metadata handoff
--
-- COWORK (anon key) writes per-colorway metadata to agron_products_staging
-- during its run; Claude Code (service role) calls
-- promote_agron_products_from_staging() to create/backfill the matching
-- products rows. Keeps the service-role key out of the bot while still letting
-- the full Agron catalog (stock already in agron_inventory) get product rows so
-- it renders on /adidas.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.agron_products_staging (
  code            text primary key,   -- colorway code (= agron_inventory.sku / variation.code)
  product_number  text,               -- product.number (style)
  name            text,
  color           text,
  product_type    text,               -- raw tags["Product"]: Bag, Sock, Sock-Team, Headwear, Underwear, Sp Acc, Knit, …
  gender          text,               -- tags["Gender"]
  adidas_article  text,               -- tags["adidas Article #"] (reference only)
  colorway_status text,               -- tags["Colorway Status"] (ACTIVE/…)
  retail_price    numeric,            -- prices.elastic_retail
  nsa_cost        numeric,            -- prices.elastic_wholesale (actual wholesale, no markup)
  image_url       text,               -- variation.images[firstKey][0].large
  description     text,               -- product.description (+ features)
  sizes           jsonb,              -- optional; promote prefers live agron_inventory sizes
  last_synced     timestamptz default now(),
  source          text default 'agron-api'
);

-- RLS mirrors agron_inventory (anon read + write, so COWORK fills it with the anon key)
alter table public.agron_products_staging enable row level security;
drop policy if exists "agron_products_staging_all"       on public.agron_products_staging;
drop policy if exists "agron_products_staging_anon_read" on public.agron_products_staging;
create policy "agron_products_staging_all"       on public.agron_products_staging for all    using (true) with check (true);
create policy "agron_products_staging_anon_read" on public.agron_products_staging for select using (true);

-- Category map (spec §2): Agron tags["Product"] → portal category
create or replace function public._agron_map_category(p_type text)
returns text language sql immutable as $map$
  select case lower(btrim(coalesce(p_type,'')))
    when 'sock' then 'Socks' when 'sock-team' then 'Socks' when 'socks-team' then 'Socks'
    when 'bag' then 'Bags'
    when 'headwear' then 'Hats' when 'knit' then 'Hats'
    when 'underwear' then 'Underwear'
    when 'sp acc' then 'Sport Accessories' when 'sport acc' then 'Sport Accessories'
    when '' then 'Accessories'
    else 'Accessories' end
$map$;

-- Promote staging → products. SECURITY INVOKER: only a role that can write
-- products (service role / Claude Code) can effectively run it, so the bot can
-- fill staging but not mutate products. Idempotent: fill-empties on existing
-- rows, create-if-missing otherwise. Returns (created, updated).
create or replace function public.promote_agron_products_from_staging()
returns table(created integer, updated integer)
language plpgsql
as $func$
declare v_created integer := 0; v_updated integer := 0;
begin
  with upd as (
    update public.products p set
      category         = coalesce(p.category, public._agron_map_category(s.product_type)),
      retail_price     = coalesce(p.retail_price, s.retail_price),
      nsa_cost         = coalesce(p.nsa_cost, s.nsa_cost),
      image_front_url  = coalesce(nullif(p.image_front_url,''), s.image_url),
      description      = coalesce(nullif(p.description,''), s.description),
      inventory_source = 'agron',
      is_active        = (upper(coalesce(s.colorway_status,'ACTIVE')) = 'ACTIVE'),
      is_archived      = false,
      updated_at       = now()
    from public.agron_products_staging s
    where p.sku = s.code and p.vendor_id = 'v1777312659133'
    returning 1
  ) select count(*) into v_updated from upd;

  with ins as (
    insert into public.products
      (id, sku, name, brand, vendor_id, color, category, retail_price, nsa_cost,
       available_sizes, image_front_url, description, is_active, is_archived, inventory_source)
    select 'p-agron-'||s.code, s.code, s.name, 'Adidas', 'v1777312659133', s.color,
       public._agron_map_category(s.product_type), s.retail_price, s.nsa_cost,
       coalesce((select to_jsonb(array_agg(distinct ai.size order by ai.size))
                   from public.agron_inventory ai where ai.sku = s.code),
                s.sizes, '[]'::jsonb),
       s.image_url, s.description,
       (upper(coalesce(s.colorway_status,'ACTIVE')) = 'ACTIVE'), false, 'agron'
    from public.agron_products_staging s
    where not exists (
      select 1 from public.products p where p.sku = s.code and p.vendor_id = 'v1777312659133')
    returning 1
  ) select count(*) into v_created from ins;

  return query select v_created, v_updated;
end
$func$;
