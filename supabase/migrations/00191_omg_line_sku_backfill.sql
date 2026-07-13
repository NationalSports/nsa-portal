-- ═══════════════════════════════════════════════════════════════════
-- 00191 — Backfill empty SKUs on OMG parent order lines from product names
--
-- The OMG report ingest extracted SKUs only from the color string's "(SKU)"
-- suffix; rows without it landed with an empty SKU, which breaks the
-- SKU+size match that drives receiving-based parent status sync
-- (OMG_TRACKING_AUDIT_2026-07-11.md fix #5). The report product names carry
-- the SKU as the trailing token ("Sport-Tek Repeat 7" Short ST485 ST485").
--
-- Guarded: only fills a line whose name's last token EXACTLY matches a SKU
-- on that order's own linked Sales Order — no fuzzy matching, no cross-SO
-- guesses. Idempotent; safe to re-run. (Applied to production 2026-07-12:
-- 210 lines.) The ingest functions now derive the SKU at import time
-- (skuFromProductName in netlify/functions/_shared.js), so new stores don't
-- need this.
-- ═══════════════════════════════════════════════════════════════════

update public.webstore_order_items i
   set sku = s.sku
  from public.webstore_orders o, public.so_items s
 where i.order_id = o.id
   and (i.sku is null or trim(i.sku) = '')
   and s.so_id = o.so_id
   and upper(trim(s.sku)) = upper((regexp_match(trim(coalesce(i.name,'')), '(\S+)$'))[1]);
