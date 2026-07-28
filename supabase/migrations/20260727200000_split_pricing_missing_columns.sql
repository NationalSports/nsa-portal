-- Split-job pricing (#1789, 2026-07-23) shipped four client-written fields with no migration.
-- The client writes one row shape per table (_decoCols / _jobCols), so every payload carrying one
-- of these keys was rejected by PostgREST (PGRST204) and recovered by re-sending the batch stripped
-- of every "extra" column — silently dropping deco_type, vendor, color_way_id, placement, deco_po_id,
-- the split grouping and the coach/follow-up flags along with it.
--
-- split_runs is the per-run quantity partition stamped by stampSplitRuns and read by decoSplitRuns to
-- bill each press run at its own qty tier. It is stamped only at split/merge time and never re-derived
-- on load, so without a column to hold it a split design silently reverted to combined-tier billing on
-- the next reload — an undercharge, not just a cosmetic loss.
ALTER TABLE public.so_item_decorations
  ADD COLUMN IF NOT EXISTS split_runs JSONB;
ALTER TABLE public.estimate_item_decorations
  ADD COLUMN IF NOT EXISTS split_runs JSONB;

-- priced_separately / price_override drive whether a split design partitions at all, and split_group
-- carries the job's split grouping. All three are written by the split/merge handlers in OrderEditor.
ALTER TABLE public.so_jobs
  ADD COLUMN IF NOT EXISTS priced_separately BOOLEAN,
  ADD COLUMN IF NOT EXISTS price_override JSONB,
  ADD COLUMN IF NOT EXISTS split_group TEXT;
