-- Add color_way_id_b to decoration tables for the second-side colorway on
-- reversible decorations. Without this column, saves that include color_way_id_b
-- fail with a schema-cache error and the retry path strips ALL "extra" columns
-- (including reversible and color_way_id), wiping the user's data on refresh.

ALTER TABLE so_item_decorations
  ADD COLUMN IF NOT EXISTS color_way_id_b TEXT;

ALTER TABLE estimate_item_decorations
  ADD COLUMN IF NOT EXISTS color_way_id_b TEXT;

NOTIFY pgrst, 'reload schema';
