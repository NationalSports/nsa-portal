-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 015: Fold Adidas vendor inventory into stock
-- PURELY ADDITIVE — CREATE OR REPLACE VIEW only (appends vendor_* columns).
-- Adidas inventory (adidas_inventory, ~50k rows keyed by sku+size) carries
-- live drop-ship availability AND future delivery dates, so it now counts
-- toward storefront stock alongside on-hand warehouse inventory.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW webstore_storefront_products AS
SELECT
  wp.id AS webstore_product_id, wp.store_id, wp.kind, wp.product_id, wp.sku,
  COALESCE(wp.display_name, p.name) AS name, p.category, p.color, p.available_sizes,
  COALESCE(wp.image_url, p.image_front_url) AS image_front_url, p.image_back_url,
  wp.retail_price, wp.decoration_id, wp.sort_order, inv.size_stock,
  COALESCE(eta_pid.on_order_qty, eta_sku.on_order_qty) AS on_order_qty,
  COALESCE(eta_pid.earliest_eta, eta_sku.earliest_eta) AS earliest_eta,
  COALESCE(wp.fundraise_amount, 0) AS fundraise_amount,
  wp.retail_price + COALESCE(wp.fundraise_amount, 0) AS display_price,
  av.vendor_size_stock, COALESCE(av.vendor_on_hand, 0) AS vendor_on_hand, av.vendor_eta
FROM webstore_products wp
LEFT JOIN products p ON p.id = wp.product_id
LEFT JOIN (SELECT product_id, jsonb_object_agg(size, quantity) AS size_stock FROM product_inventory GROUP BY product_id) inv ON inv.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_pid ON eta_pid.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_sku ON eta_sku.product_id IS NULL AND eta_sku.sku = wp.sku
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(ai.size, ai.stock_qty) AS vendor_size_stock,
         COALESCE(SUM(GREATEST(ai.stock_qty, 0)), 0) AS vendor_on_hand,
         MIN(NULLIF(ai.future_delivery_date, '')) FILTER (WHERE COALESCE(ai.stock_qty, 0) <= 0) AS vendor_eta
  FROM adidas_inventory ai
  WHERE ai.sku = wp.sku
    AND (p.available_sizes IS NULL OR ai.size IN (SELECT jsonb_array_elements_text(p.available_sizes)))
) av ON true
WHERE wp.active = true;
