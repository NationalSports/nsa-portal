-- Add shipping address fields to deco_vendors so the warehouse can ship goods
-- to a decorator (or back to our warehouse) via Manual Ship. These let the
-- Manual Ship modal prefill a decorator's ship-to address instead of always
-- shipping to the customer/school.

ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE deco_vendors ADD COLUMN IF NOT EXISTS zip text;
