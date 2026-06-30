-- ════════════════════════════════════════════════════════════════════
-- Migration 00119 — Agron cost = retail × 0.5 × 0.75  (= retail × 0.375)
--
-- Agron's elastic_wholesale is retail × 0.5 (the standard 50%); NSA gets an
-- extra 25% off, so the true NSA cost is retail × 0.5 × 0.75 = retail × 0.375.
-- The /adidas catalog shows the Agron MSRP as retail_price and retail × 0.375 as
-- nsa_cost. This supersedes migration 00118's promote, which stored
-- staging.nsa_cost (= the raw elastic_wholesale) directly and so priced items
-- ~33% too high.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- ════════════════════════════════════════════════════════════════════

create or replace function public.promote_agron_products_from_staging()
returns table(created integer, updated integer)
language plpgsql
as $func$
declare v_created integer := 0; v_updated integer := 0;
begin
  with upd as (
    update public.products p set
      category         = coalesce(p.category, public._agron_map_category(s.product_type)),
      retail_price     = s.retail_price,                     -- Agron MSRP (retail shown = ours)
      nsa_cost         = round(s.retail_price * 0.375, 2),   -- retail × 0.5 × 0.75
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
       public._agron_map_category(s.product_type),
       s.retail_price, round(s.retail_price * 0.375, 2),
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

-- Backfill existing Agron rows to the corrected pricing
update public.products p
set retail_price = s.retail_price,
    nsa_cost     = round(s.retail_price * 0.375, 2),
    updated_at   = now()
from public.agron_products_staging s
where p.sku = s.code and p.vendor_id = 'v1777312659133'
  and ( p.retail_price is distinct from s.retail_price
        or p.nsa_cost is distinct from round(s.retail_price * 0.375, 2) );
