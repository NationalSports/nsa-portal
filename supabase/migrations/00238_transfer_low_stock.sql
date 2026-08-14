-- Transfer low-stock alert throttle (00238).
--
-- Heat-transfer inventory (webstore_transfers) had NO proactive low-stock
-- signal: the only indicator was the transfers page's amber "Avail < 10" text,
-- visible only when someone opened that store's page — a store nobody opens
-- silently runs out and club orders then pull into shortfalls. The
-- backorder-ready-sweep (00236) now emails the ops/decoration channel when an
-- OPEN store's transfer is below threshold with nothing incoming; this column
-- throttles that alert to once per week per transfer row.
alter table public.webstore_transfers add column if not exists low_stock_notified_at timestamptz;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   alter table public.webstore_transfers drop column if exists low_stock_notified_at;
