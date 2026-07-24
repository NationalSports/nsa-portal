-- Data-fix record (applied manually 2026-07-24, committed here for auditability and
-- idempotent re-runs).
--
-- Symptom: Sales Orders / Estimates showed the WRONG color for some Adidas items —
-- e.g. SO-1439 line JX4467 (a White "Adidas Unisex Pregame Tee") displayed the chip
-- "Black/White", which is actually the sibling colorway JX4452's color.
--
-- Root cause: color is DENORMALIZED onto the line at add time (so_items.color /
-- estimate_items.color are copied from products.color) and the Adidas color chip is
-- rendered read-only from that stored value (OrderEditor.js). Several products were
-- mislabeled at creation with a sibling colorway's name (JX4467="Black/White",
-- JX4458="Orange/White", the Game&Go/Fleece greys="Grey") and were later corrected in
-- the catalog (products.color). The already-saved order/estimate lines kept the stale
-- copy, so the catalog page showed the corrected color while the SO/estimate did not.
--
-- Fix: for NON-custom lines whose product_id still resolves to the correct product
-- (sku matches), realign the stored color to that product's current color — but ONLY
-- where the stale value is a *real sibling colorway* of the same style+vendor (a
-- genuine wrong-color display), so per-line color choices on multi-color blanks
-- (Richardson 112 caps) and custom items are left untouched.
--
-- Verified before applying: product_id/sku/cost/price on every affected line already
-- pointed at the correct garment; only the color string was stale.
-- Rows corrected: so_items = 16, estimate_items = 10.
-- Re-run safely any time a future catalog color correction strands old lines.

update so_items si
set color = p.color
from products p
where si.product_id = p.id
  and coalesce(si.is_custom, false) = false
  and si.color is not null and btrim(si.color) <> ''
  and p.color  is not null and btrim(p.color)  <> ''
  and lower(btrim(si.color)) <> lower(btrim(p.color))
  and exists (
    select 1 from products s
    where lower(btrim(s.name)) = lower(btrim(p.name))
      and coalesce(s.vendor_id, '') = coalesce(p.vendor_id, '')
      and s.sku <> p.sku
      and lower(btrim(s.color)) = lower(btrim(si.color))
  );

update estimate_items ei
set color = p.color
from products p
where ei.product_id = p.id
  and coalesce(ei.is_custom, false) = false
  and ei.color is not null and btrim(ei.color) <> ''
  and p.color  is not null and btrim(p.color)  <> ''
  and lower(btrim(ei.color)) <> lower(btrim(p.color))
  and exists (
    select 1 from products s
    where lower(btrim(s.name)) = lower(btrim(p.name))
      and coalesce(s.vendor_id, '') = coalesce(p.vendor_id, '')
      and s.sku <> p.sku
      and lower(btrim(s.color)) = lower(btrim(ei.color))
  );
