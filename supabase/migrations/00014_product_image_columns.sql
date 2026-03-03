-- ============================================================
-- NSA Portal – Add image columns to products table
-- Migration: 00014_product_image_columns
--
-- The products table was created in migration 00007 without
-- image_front_url and image_back_url columns. This caused
-- _dbSaveProduct to silently strip image URLs on every save,
-- so product photos were never persisted to the database.
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_front_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_back_url TEXT;
