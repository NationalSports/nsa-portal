-- 00178 — Team Store Tracking (coach portal 1A redesign) — two additive fields
--
-- The redesigned coach-facing Team Store Tracking card (src/CoachPortal.js,
-- CoachStoreCard) surfaces two things the schema didn't yet back:
--
--   1. webstores.fundraise_goal — a dollar target for the store's fundraising.
--      Drives the "Fundraising goal" progress bar. Staff set it in the store
--      settings Fundraising section (src/Webstores.js). NULL / 0 = no goal set,
--      and the coach card simply hides the bar.
--
--   2. webstore_order_items.backorder_eta — expected arrival date for a line the
--      staff have marked short (missing_qty > 0). The "Backordered · ETA …" badge
--      reads it; staff set it beside the short-qty input in the Batches ship view.
--      NULL = unknown ETA, badge shows "Backordered" with no date.
--
-- Both columns are additive and nullable, so this is backward-compatible: code
-- shipped before it ignores the columns, and the new UI degrades gracefully when
-- they are absent (a pre-migration DB) or NULL. No RLS changes — existing SELECT
-- policies already expose every column on these tables to the coach, and the
-- existing staff write policies already cover both tables.

alter table public.webstores
  add column if not exists fundraise_goal numeric;

alter table public.webstore_order_items
  add column if not exists backorder_eta date;
