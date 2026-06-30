-- Add a per-line-item notes field to estimate and sales order items.
-- These notes show on the estimate / sales order / invoice PDFs directly
-- under the sizes line so coaches / customers can see them.

ALTER TABLE public.estimate_items
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.sales_order_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
