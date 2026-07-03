-- ════════════════════════════════════════════════════════════════════
-- Migration 00165 — adidas_inventory size-label cleanup + write guard
--
-- The 2026-06-25/26 Cowork sync run wrote with a stale / unloaded size map
-- (the live skill's hardcoded seed overrides the corrected adidas_size_maps
-- row — same regression cleaned on 2026-06-21):
--   • 703 phantom 6XL/7XL rows. adidas apparel tops out at 5XL; codes 360/370
--     are ST/MT, so real tall stock was written under impossible labels.
--   • ~19.9K rows keyed by raw 3-digit size codes ("520") duplicating their
--     labeled twins' stock — double-counted units + junk size chips on /adidas.
--   • 62 rows with Cowork's ~9,999,999 "unlimited" sentinel in stock_qty
--     (the skill only nulls the sentinel for future_delivery_qty).
--
-- Cleanup below, plus a BEFORE INSERT/UPDATE guard so a broken run can't
-- reintroduce any of the three until the live skill is fixed. The guard name
-- sorts before trg_adidas_inventory_skip_noop so the clamp runs first.
--
-- Applied to project hpslkvngulqirmbstlfx via supabase apply_migration.
-- ════════════════════════════════════════════════════════════════════

-- 1) Phantom 6XL/7XL → relabel to ST/MT where the SKU carries a tall run and
--    has no ST/MT row yet (recovers the real tall stock written under the
--    wrong label; id follows the `${sku}-${size}` convention).
update public.adidas_inventory ai
   set size = case when upper(ai.size) = '6XL' then 'ST' else 'MT' end,
       id   = ai.sku || '-' || case when upper(ai.size) = '6XL' then 'ST' else 'MT' end
 where upper(ai.size) in ('6XL', '7XL')
   and exists (select 1 from public.adidas_inventory t
                where t.sku = ai.sku
                  and upper(t.size) in ('LT','XLT','2XLT','3XLT','4XLT','5XLT'))
   and not exists (select 1 from public.adidas_inventory t
                where t.sku = ai.sku
                  and upper(t.size) = case when upper(ai.size) = '6XL' then 'ST' else 'MT' end);

-- 2) Delete the remaining phantoms: an existing ST/MT twin means the phantom
--    is a stale duplicate, and footwear / no-tall-run rows aren't mappable
--    here — the fixed sync rewrites those sizes correctly.
delete from public.adidas_inventory where upper(size) in ('6XL', '7XL');

-- 3) Raw 3-digit code rows: every one with a labeled twin double-counts that
--    twin's stock; the handful without a twin hold zero stock. Real footwear
--    labels are 1–2 digits ("10", "10-", "11K"), so ^[0-9]{3}$ never matches
--    a legitimate size.
delete from public.adidas_inventory where size ~ '^[0-9]{3}$';

-- 4) "Unlimited" sentinel clamp: 9999 renders as "999+" on /adidas without
--    wrecking unit-count sorts; sentinel future qty means "no real number".
update public.adidas_inventory set stock_qty = 9999 where stock_qty >= 1000000;
update public.adidas_inventory set future_delivery_qty = null where future_delivery_qty >= 1000000;

-- 5) Write guard — skip size labels that can't exist on adidas gear and clamp
--    sentinel quantities at write time.
create or replace function public.adidas_inventory_write_guard()
returns trigger language plpgsql as $$
begin
  if new.size ~ '^[0-9]{3}$' or upper(new.size) in ('6XL', '7XL') then
    return null;  -- raw conversion code / phantom label: drop the write
  end if;
  if new.stock_qty >= 1000000 then new.stock_qty := 9999; end if;
  if new.future_delivery_qty >= 1000000 then new.future_delivery_qty := null; end if;
  return new;
end;
$$;

drop trigger if exists trg_adidas_inventory_guard on public.adidas_inventory;
create trigger trg_adidas_inventory_guard
  before insert or update on public.adidas_inventory
  for each row execute function public.adidas_inventory_write_guard();
