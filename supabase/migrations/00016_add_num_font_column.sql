-- Add num_font and num_size_back columns to decoration tables
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS num_font TEXT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS num_font TEXT;
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS num_size_back TEXT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS num_size_back TEXT;

-- Re-ensure columns from migrations 00013/00015 exist (idempotent safety net)
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS print_color TEXT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS print_color TEXT;
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS front_and_back BOOLEAN DEFAULT false;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS front_and_back BOOLEAN DEFAULT false;
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS num_qty INT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS num_qty INT;
ALTER TABLE public.estimate_item_decorations ADD COLUMN IF NOT EXISTS name_qty INT;
ALTER TABLE public.so_item_decorations ADD COLUMN IF NOT EXISTS name_qty INT;
