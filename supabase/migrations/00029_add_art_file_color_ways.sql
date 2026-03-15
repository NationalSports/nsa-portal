-- Add missing columns to so_art_files and estimate_art_files
-- These columns are used by the app but were never added to the schema,
-- causing upsert failures (400 errors) on every save.

ALTER TABLE so_art_files
  ADD COLUMN IF NOT EXISTS color_ways JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS art_sizes JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS garment_colors JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS item_mockups JSONB DEFAULT '{}';

ALTER TABLE estimate_art_files
  ADD COLUMN IF NOT EXISTS color_ways JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS art_sizes JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS garment_colors JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS item_mockups JSONB DEFAULT '{}';

-- Add color_way_id to decoration tables for CW selection on decorations
ALTER TABLE so_item_decorations
  ADD COLUMN IF NOT EXISTS color_way_id TEXT;

ALTER TABLE estimate_item_decorations
  ADD COLUMN IF NOT EXISTS color_way_id TEXT;
