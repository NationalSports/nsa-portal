-- Adds an is_footwear flag to line items so the editor can swap the size grid
-- to shoe sizes (6-14) and apply footwear-specific cost multipliers for
-- Adidas/UA branded items.
--
-- The cost auto-calc lives in src/OrderEditor.js:
--   Adidas footwear cost = retail * 0.55 * 0.75
--   UA footwear cost     = retail * 0.55 * 0.85

ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS is_footwear BOOLEAN DEFAULT false;

ALTER TABLE so_items
  ADD COLUMN IF NOT EXISTS is_footwear BOOLEAN DEFAULT false;
