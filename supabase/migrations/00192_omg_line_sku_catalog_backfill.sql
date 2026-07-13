-- ═══════════════════════════════════════════════════════════════════
-- 00192 — Backfill OMG parent-line SKUs via the store catalog (unique
--         containment)
--
-- Second pass after 00191 (trailing-name-token). Some OMG line names are
-- "<catalog product name> <display alias>" concatenations with no SKU token
-- ("Adidas 3 Stripe Short - Grey 3 STRIPE SHORT"). The omg_store_products
-- catalog carries the same OMG-native names WITH SKUs, so containment
-- against it is same-source and reliable.
--
-- Guards (no fuzzy guessing):
--   • only lines whose current SKU matches nothing on their linked SO
--   • catalog name >= 8 chars, contained verbatim (case-insensitive)
--   • the catalog SKU must exist on the line's own linked Sales Order
--   • EXACTLY ONE distinct catalog SKU may match — ambiguity = no update
--
-- Idempotent; safe to re-run. (Applied to production 2026-07-12: bridged
-- 125 of the 159 then-unmatched lines; measured beforehand with the same
-- predicate.) The ingest functions now apply the same rule at import time
-- (skuFromCatalogName in netlify/functions/_shared.js).
-- ═══════════════════════════════════════════════════════════════════

with unmatched as (
  select o.so_id, w.omg_sale_code, i.id,
         upper(trim(coalesce(i.name,''))) as name_raw
  from public.webstore_order_items i
  join public.webstore_orders o on o.id = i.order_id
  join public.webstores w on w.id::text = o.store_id::text
  where w.source = 'omg' and o.so_id is not null
    and not exists (
      select 1 from public.so_items s where s.so_id = o.so_id
        and (upper(trim(s.sku)) = regexp_replace(upper(trim(coalesce(i.sku,''))),'\s*-\s*\d+$','')
          or (trim(coalesce(i.sku,'')) <> '' and upper(trim(s.sku)) = split_part(regexp_replace(upper(trim(coalesce(i.sku,''))),'\s*-\s*\d+$',''),' ',1))
          or upper(trim(s.sku)) = upper((regexp_match(trim(coalesce(i.name,'')), '(\S+)$'))[1])
          or upper(trim(s.name)) = upper(trim(coalesce(i.name,''))))
    )
),
resolved as (
  select u.id, min(upper(trim(p.sku))) as sku
  from unmatched u
  join public.omg_store_products p on p.store_id = 'OMG-sale_' || u.omg_sale_code
    and length(trim(p.name)) >= 8
    and position(upper(trim(p.name)) in u.name_raw) > 0
    and exists (select 1 from public.so_items s
                 where s.so_id = u.so_id and upper(trim(s.sku)) = upper(trim(p.sku)))
  group by u.id
  having count(distinct upper(trim(p.sku))) = 1
)
update public.webstore_order_items i
   set sku = r.sku
  from resolved r
 where i.id = r.id;
