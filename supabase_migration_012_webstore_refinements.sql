-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 012: Webstore refinements
-- Run in the Supabase SQL Editor. PURELY ADDITIVE — only ADD COLUMN
-- (with defaults) and CREATE OR REPLACE VIEW. No drops/renames/backfills.
-- ═══════════════════════════════════════════════════════════════════

-- Club director / coach contact (gets portal access to track their store)
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN director_name TEXT;  EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN director_email TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN director_phone TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Delivery options offered by the store
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN ship_home_enabled    BOOLEAN DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN deliver_club_enabled BOOLEAN DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Per-item fundraising: the catalog row's price is the base (X); fundraise_amount
-- (Y) is added on top, so the shopper pays X+Y and Y is the fundraising portion.
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN fundraise_amount NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Storefront view: expose fundraise_amount and a combined display_price.
-- NOTE: CREATE OR REPLACE requires existing columns keep their order; new
-- columns (fundraise_amount, display_price) are APPENDED at the end.
CREATE OR REPLACE VIEW webstore_storefront_products AS
SELECT
  wp.id            AS webstore_product_id,
  wp.store_id,
  wp.kind,
  wp.product_id,
  wp.sku,
  COALESCE(wp.display_name, p.name) AS name,
  p.category,
  p.color,
  p.available_sizes,
  p.image_front_url,
  p.image_back_url,
  wp.retail_price,
  wp.decoration_id,
  wp.sort_order,
  inv.size_stock,
  COALESCE(eta_pid.on_order_qty, eta_sku.on_order_qty) AS on_order_qty,
  COALESCE(eta_pid.earliest_eta, eta_sku.earliest_eta) AS earliest_eta,
  COALESCE(wp.fundraise_amount, 0)                      AS fundraise_amount,
  wp.retail_price + COALESCE(wp.fundraise_amount, 0)    AS display_price
FROM webstore_products wp
LEFT JOIN products p ON p.id = wp.product_id
LEFT JOIN (
  SELECT product_id, jsonb_object_agg(size, quantity) AS size_stock
  FROM product_inventory
  GROUP BY product_id
) inv ON inv.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_pid ON eta_pid.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_sku ON eta_sku.product_id IS NULL AND eta_sku.sku = wp.sku
WHERE wp.active = true;
