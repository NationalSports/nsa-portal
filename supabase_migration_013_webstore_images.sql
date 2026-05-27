-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 013: Webstore custom product images
-- PURELY ADDITIVE — one ADD COLUMN + CREATE OR REPLACE VIEW (same column
-- shape, image_front_url now prefers the store's uploaded image).
-- ═══════════════════════════════════════════════════════════════════

-- Per-store custom image (Cloudinary URL). Overrides the vendor stock photo.
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN image_url TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

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
  COALESCE(wp.image_url, p.image_front_url) AS image_front_url,   -- uploaded image wins
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
