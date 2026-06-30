-- Per-line-item notes that show on estimate / SO / invoice PDFs.
-- Migration 00059 was supposed to add this but referenced
-- `sales_order_items` (which doesn't exist) for the SO branch,
-- and the estimate branch never made it onto the live database.
-- Without this column the batch insert from `_dbSaveEstimateInner`
-- fails when an item has a `notes` value, falls back to a
-- core-columns-only retry, and silently drops `est_qty` / `qty_only`
-- along with the unknown columns — meaning the "No Sizes (Qty Only)"
-- quantity wouldn't persist on reload.

ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.so_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
