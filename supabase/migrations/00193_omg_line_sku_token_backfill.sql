-- ═══════════════════════════════════════════════════════════════════
-- 00193 — Backfill OMG parent-line SKUs where a name TOKEN equals an SO SKU
--
-- Third pass after 00191 (trailing token) and 00192 (catalog containment).
-- Some line names embed the SKU mid-string ("ADIDAS WOMENS 3-STRIPES
-- FULL-ZIP JACKET - BLACK A268 BLACK"). Guard: exactly ONE distinct SKU on
-- the line's own linked Sales Order may appear as a whitespace token of the
-- line name; ambiguity = no update. Idempotent; safe to re-run.
-- (Applied to production 2026-07-12: 3 lines.)
--
-- Remaining unlinkable lines after this pass are packing-slip parse
-- fragments ("SPORT TEE", "*CROSS*") or products that are NOT on the SO at
-- all (e.g. cleats/girdles the rep didn't carry over) — those have nothing
-- to link to and stay at on-order until handled manually.
-- ═══════════════════════════════════════════════════════════════════

with unmatched as (
  select o.so_id, i.id, upper(trim(coalesce(i.name,''))) as name_raw
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
  select u.id, min(upper(trim(s.sku))) as sku
  from unmatched u
  join lateral unnest(string_to_array(u.name_raw, ' ')) t(w) on true
  join public.so_items s on s.so_id = u.so_id and upper(trim(s.sku)) = t.w
  group by u.id
  having count(distinct upper(trim(s.sku))) = 1
)
update public.webstore_order_items i
   set sku = r.sku
  from resolved r
 where i.id = r.id;
