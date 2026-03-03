-- Add missing columns to decoration tables that exist in _decoCols but not in DB
-- front_and_back: for numbers with front+back doubling
-- num_qty: manual number quantity override (when no roster assigned)
-- name_qty: manual name quantity override (when no names assigned)

ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS front_and_back BOOLEAN DEFAULT false;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS front_and_back BOOLEAN DEFAULT false;

ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS num_qty INT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS num_qty INT;

ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS name_qty INT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS name_qty INT;

-- Add missing shipping columns to sales_orders (added to _soCols but not DB)
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS _shipments JSONB;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS _shipping_cost NUMERIC;
