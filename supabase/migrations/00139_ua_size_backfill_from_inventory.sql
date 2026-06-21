-- ════════════════════════════════════════════════════════════════════
-- Migration 00121 — Under Armour: real size runs from ua_inventory
--
-- Problem: the order screen's size grid (OrderEditor) renders a product's
-- `available_sizes` filtered to the canonical SZ_ORD list. The ~2,239 UA
-- products that existed BEFORE the Armour House sync were left with the
-- default apparel run ["S","M","L","XL","2XL"] — so a duffle BAG (one size),
-- a YOUTH jersey, or a SHOE all showed S–2XL.
--
-- The real per-size data has been syncing into `ua_inventory` (one row per
-- sku+size). migration 00120's promote() only set `available_sizes` on INSERT
-- (new colorways) and never on UPDATE, so the pre-existing rows never picked
-- it up. This migration:
--   1. adds a size normalizer + canonical-ordered builder (mirrors the JS
--      SZ_NORM / SZ_ORD in src/constants.js so the grid renders every label),
--   2. backfills products.available_sizes from ua_inventory for all UA rows,
--   3. fixes promote_ua_products_from_staging() to refresh available_sizes on
--      BOTH insert and update, so future syncs stay correct.
--
-- GUARD: a product is only rewritten when the normalized run is NON-EMPTY.
-- UA sizes the apparel/footwear/OSFA grid can't represent (waist/inseam combos
-- like 32/30, bra bands like "M D-DD", fitted-hat combos like "S/M") normalize
-- to nothing and are left exactly as they are — never blanked.
--
-- Applied to project hpslkvngulqirmbstlfx. Idempotent (OR REPLACE / guarded).
-- ════════════════════════════════════════════════════════════════════

-- ─── 1) Normalize a raw supplier size label → portal-canonical label ───
-- Mirrors the relevant entries of SZ_NORM in src/constants.js. Anything not
-- mapped passes through upper-cased (numerics, tall ST/MT/4XLT…, OSFA, youth
-- YS/YM/YL/YXL, etc. are already canonical); non-canonical labels survive here
-- but are dropped by the SZ_ORD filter in _ua_canon_sizes below.
create or replace function public._norm_ua_size(p_raw text)
returns text language sql immutable as $$
  select case upper(trim(coalesce(p_raw,'')))
    when ''          then null
    -- one size
    when 'OSFM' then 'OSFA' when 'OSFA' then 'OSFA' when 'OS' then 'OSFA'
    when 'ONE SIZE' then 'OSFA' when 'NONE' then 'OSFA' when 'N/A' then 'OSFA'
    -- letter aliases
    when 'XXS' then 'XXS' when '2XS' then 'XXS'
    when 'SM' then 'S' when 'SML' then 'S' when 'SMALL' then 'S'
    when 'MD' then 'M' when 'MED' then 'M' when 'MEDIUM' then 'M'
    when 'LG' then 'L' when 'LRG' then 'L' when 'LARGE' then 'L'
    when 'XLG' then 'XL' when 'XLARGE' then 'XL' when 'X-LARGE' then 'XL'
    when 'XXL' then '2XL' when '2X' then '2XL' when '2XLARGE' then '2XL'
    when 'XXXL' then '3XL' when '3X' then '3XL'
    when 'XXXXL' then '4XL' when '4X' then '4XL'
    when '5X' then '5XL' when '6X' then '6XL'
    -- youth (UA: YSM/YMD/YLG → YS/YM/YL)
    when 'YSM' then 'YS' when 'YMD' then 'YM' when 'YLG' then 'YL'
    when 'YOUTH SMALL' then 'YS' when 'YOUTH MEDIUM' then 'YM'
    when 'YOUTH LARGE' then 'YL' when 'YOUTH XL' then 'YXL'
    else upper(trim(p_raw))
  end
$$;

-- ─── 2) Build a product's canonical size run from ua_inventory ───
-- distinct normalized sizes ∩ SZ_ORD, ordered by SZ_ORD position → jsonb array.
-- The array literal MUST match SZ_ORD in src/constants.js (the order grid uses
-- exactly that list to filter + sort the size columns).
create or replace function public._ua_canon_sizes(p_sku text)
returns jsonb language sql stable as $$
  with ord as (
    select sz, ord from unnest(array[
      'YXS','YS','YM','YL','YXL','YOUTH','XXS','XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL',
      'ST','MT','LT','XLT','2XLT','3XLT','4XLT','5XLT','OSFA',
      'XS-SM','S-M','SM-MD','MD-LG','L-XL','LG-XL','XL-2XL',
      '4.5','5','5.5','6','6.5','7','7.5','8','8.5','9','9.5','10','10.5','11','11.5','12',
      '12.5','13','13.5','14','14.5','15','15.5','16','16.5','17',
      '28','30','32','34','36','38','40','42','44','46','48','50','52','54'
    ]) with ordinality as t(sz,ord)
  ),
  norm as (
    select distinct public._norm_ua_size(ui.size) as sz
    from public.ua_inventory ui where ui.sku = p_sku
  )
  select coalesce(jsonb_agg(o.sz order by o.ord), '[]'::jsonb)
  from ord o join norm n on n.sz = o.sz;
$$;

-- ─── 3) One-time backfill: refresh UA products from their live inventory ───
-- Guarded: only when the normalized run is non-empty AND differs from what's
-- stored (so combo/waist/bra products keep their current value, untouched).
update public.products p
set available_sizes = c.sizes,
    updated_at      = now()
from (
  select sku, public._ua_canon_sizes(sku) as sizes
  from public.products
  where inventory_source = 'ua'
) c
where p.sku = c.sku
  and p.inventory_source = 'ua'
  and jsonb_array_length(c.sizes) > 0
  and p.available_sizes is distinct from c.sizes;

-- ─── 4) Durability: promote() now refreshes available_sizes every run ───
-- Same body as migration 00120, except:
--   • INSERT pulls available_sizes from _ua_canon_sizes (canonical + ordered;
--     00120 used a raw alphabetical array_agg), falling back to staging sizes.
--   • UPDATE now ALSO refreshes available_sizes from live ua_inventory when a
--     non-empty run exists — closing the gap that left pre-existing rows stale.
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
      available_sizes  = case when jsonb_array_length(public._ua_canon_sizes(s.sku)) > 0
                              then public._ua_canon_sizes(s.sku)
                              else p.available_sizes end,
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
       case when jsonb_array_length(public._ua_canon_sizes(s.sku)) > 0
            then public._ua_canon_sizes(s.sku)
            else coalesce(s.sizes, '[]'::jsonb) end,
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
