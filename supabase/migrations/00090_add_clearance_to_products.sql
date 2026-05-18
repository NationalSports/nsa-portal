-- Clearance pricing: admin can mark a product as clearance and set a reduced
-- "clearance cost" used in place of nsa_cost for rep margin/commission on
-- discounted sales. NSA cost stays for inventory accounting.
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_clearance BOOLEAN DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS clearance_cost NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_products_is_clearance ON products(is_clearance) WHERE is_clearance = true;
