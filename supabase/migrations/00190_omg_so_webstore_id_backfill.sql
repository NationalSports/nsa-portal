-- ═══════════════════════════════════════════════════════════════════
-- 00190 — Backfill sales_orders.webstore_id for OMG stores + catch up
--         parent tracking
--
-- createOmgSO used to set sales_orders.webstore_id with a fire-and-forget
-- UPDATE fired immediately after the SO was added to app state — before the
-- autosave engine had inserted the sales_orders row. The UPDATE matched 0
-- rows and "succeeded" silently, so 9 of the first 12 OMG SOs have
-- webstore_id NULL and the webstore_sync_status() trigger (migration 037)
-- bails on its first line for them. Parents stayed at "on order" while SOs
-- moved through production and even completion. (OMG_TRACKING_AUDIT_2026-07-11.md.)
--
-- The code fix (createOmgSO resolves the shadow webstore up front and sets
-- webstore_id in the SO object itself) prevents this for new stores. This
-- migration repairs the existing rows and fires the trigger once so parent
-- line statuses catch up to where their SO already is.
--
-- Idempotent — safe to re-run. RE-RUN NOTE: a staff browser tab that loaded
-- one of these SOs before the backfill holds webstore_id:null in memory and
-- will write that null back on its next save of that SO. Re-run this
-- migration after staff have refreshed the portal if that happens.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Link each OMG SO to its shadow webstore by sale code
--    (sales_orders.omg_store_id = 'OMG-sale_<CODE>', webstores.omg_sale_code = '<CODE>').
update public.sales_orders so
   set webstore_id = w.id
  from public.webstores w
 where so.webstore_id is null
   and so.omg_store_id is not null
   and w.source = 'omg'
   and w.omg_sale_code = replace(so.omg_store_id, 'OMG-sale_', '');

-- 2) Fire the monotonic status-sync trigger once per linked OMG SO so parent
--    order lines advance to the stage the SO can already attest to
--    ('complete' → complete, production statuses → in_production,
--    'items_received' → received; pre-production statuses are a no-op).
--    The trigger is advance-only, so this can never downgrade a line.
update public.sales_orders
   set status = status
 where omg_store_id is not null
   and webstore_id is not null;
