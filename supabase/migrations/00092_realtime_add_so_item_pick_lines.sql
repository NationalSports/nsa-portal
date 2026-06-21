-- Adds so_item_pick_lines to the supabase_realtime publication so the
-- client's "instant warehouse sync" subscription actually receives
-- INSERT/UPDATE/DELETE events.
--
-- Background: src/App.js:2257 subscribes to 7 tables for realtime
-- updates ('estimates','sales_orders','invoices','messages','customers',
-- 'products','so_item_pick_lines'). The first six are in the publication;
-- so_item_pick_lines was missed. The client error handler at line 2261
-- only logs the FIRST failing subscription and silences the rest, so
-- the user-visible CHANNEL_ERROR sometimes pinned the wrong table.
--
-- Without this fix, warehouse pick/pull events made on one tab or
-- device propagate to other clients only via the 30s polling fallback,
-- not instantly. With it, RLS-filtered postgres_changes events flow as
-- intended.
--
-- Rollback (run via SQL editor if needed):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.so_item_pick_lines;

ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_pick_lines;
