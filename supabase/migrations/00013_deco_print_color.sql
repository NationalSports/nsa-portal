-- Add print_color column to decoration tables for numbers/names color tracking
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS print_color TEXT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS print_color TEXT;
