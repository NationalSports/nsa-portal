-- Add a qty_only flag to line items so the "No Sizes (Qty Only)" mode
-- persists across reloads. When true, the UI shows a single quantity input
-- (stored in est_qty) instead of the per-size breakdown.

ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS qty_only BOOLEAN DEFAULT false;

ALTER TABLE public.so_items
  ADD COLUMN IF NOT EXISTS qty_only BOOLEAN DEFAULT false;
