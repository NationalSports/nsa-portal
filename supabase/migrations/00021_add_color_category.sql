-- Add color_category column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_category TEXT;

-- Create index for filtering by color_category
CREATE INDEX IF NOT EXISTS idx_products_color_category ON products (color_category);
