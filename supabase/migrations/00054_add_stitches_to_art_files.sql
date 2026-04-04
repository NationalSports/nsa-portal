-- Add stitches column to art file tables for embroidery thread count pricing
ALTER TABLE public.estimate_art_files ADD COLUMN IF NOT EXISTS stitches INTEGER;
ALTER TABLE public.so_art_files ADD COLUMN IF NOT EXISTS stitches INTEGER;
