-- Add reversible column to decoration tables
-- Used for reversible jerseys where both sides get decoration, doubling qty
ALTER TABLE estimate_item_decorations ADD COLUMN IF NOT EXISTS reversible boolean DEFAULT false;
ALTER TABLE so_item_decorations ADD COLUMN IF NOT EXISTS reversible boolean DEFAULT false;
