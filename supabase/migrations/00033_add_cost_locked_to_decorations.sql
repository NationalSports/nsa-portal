-- Add _cost_locked column to decoration tables so locked costs persist across reloads
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS _cost_locked NUMERIC;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS _cost_locked NUMERIC;
