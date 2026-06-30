-- Store-level fundraising rule.
--
-- Until now fundraising was set ONLY per product (webstore_products.fundraise_amount,
-- which the storefront view bakes into display_price). The store builder now has a
-- store-wide fundraising setup (a % of each item's price OR a flat $ per item, with an
-- optional round-up to the next whole dollar). These store columns already existed but
-- were dead — this migration makes them real:
--   • adds fundraise_round (round the computed amount up to the nearest $1).
--   • rewrites webstore_storefront_products.fundraise_amount / display_price so the
--     store rule fills in any item that has no explicit per-item amount. A per-item
--     fundraise_amount > 0 always wins (it's the override); the store rule only applies
--     when fundraise_enabled is on AND the item has no amount of its own.
--
-- netlify/functions/webstore-checkout mirrors this exact formula when it re-prices the
-- cart, so the price shown on the storefront equals the price charged.
--
-- The view is NOT security_invoker (runs with owner rights), so the added webstores
-- join is safe for the anon storefront and bypasses RLS like its other joins. Existing
-- stores default fundraise_enabled=false, so this is fully additive — no behavior change
-- until a store opts in.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS fundraise_round boolean DEFAULT false;

CREATE OR REPLACE VIEW webstore_storefront_products AS
 SELECT wp.id AS webstore_product_id,
    wp.store_id,
    wp.kind,
    wp.product_id,
    wp.sku,
    COALESCE(wp.display_name, p.name) AS name,
    p.category,
    p.color,
    p.available_sizes,
    COALESCE(wp.image_url, p.image_front_url) AS image_front_url,
    p.image_back_url,
    wp.retail_price,
    wp.decoration_id,
    wp.sort_order,
    inv.size_stock,
    COALESCE(eta_pid.on_order_qty, eta_sku.on_order_qty) AS on_order_qty,
    COALESCE(eta_pid.earliest_eta, eta_sku.earliest_eta) AS earliest_eta,
    fr.amt AS fundraise_amount,
    wp.retail_price + fr.amt AS display_price,
    av.vendor_size_stock,
    COALESCE(av.vendor_on_hand, 0::bigint) AS vendor_on_hand,
    av.vendor_eta,
    COALESCE(wp.takes_number, false) AS takes_number,
    COALESCE(wp.takes_name, false) AS takes_name,
    COALESCE(wp.name_upcharge, 0::numeric) AS name_upcharge,
    wp.sizes_offered,
    wp.decorations
   FROM webstore_products wp
     LEFT JOIN products p ON p.id = wp.product_id
     LEFT JOIN webstores s ON s.id = wp.store_id
     LEFT JOIN ( SELECT product_inventory.product_id,
            jsonb_object_agg(product_inventory.size, product_inventory.quantity) AS size_stock
           FROM product_inventory
          GROUP BY product_inventory.product_id) inv ON inv.product_id = wp.product_id
     LEFT JOIN webstore_product_eta eta_pid ON eta_pid.product_id = wp.product_id
     LEFT JOIN webstore_product_eta eta_sku ON eta_sku.product_id IS NULL AND eta_sku.sku = wp.sku
     LEFT JOIN LATERAL ( SELECT jsonb_object_agg(ai.size, ai.stock_qty) AS vendor_size_stock,
            COALESCE(sum(GREATEST(ai.stock_qty, 0)), 0::bigint) AS vendor_on_hand,
            min(NULLIF(ai.future_delivery_date, ''::text)) FILTER (WHERE COALESCE(ai.stock_qty, 0) <= 0) AS vendor_eta
           FROM adidas_inventory ai
          WHERE ai.sku = wp.sku AND (p.available_sizes IS NULL OR (ai.size IN ( SELECT jsonb_array_elements_text(p.available_sizes) AS jsonb_array_elements_text)))) av ON true
     LEFT JOIN LATERAL ( SELECT
          CASE
            WHEN COALESCE(wp.fundraise_amount, 0::numeric) > 0::numeric THEN wp.fundraise_amount
            WHEN s.fundraise_enabled THEN
              CASE
                WHEN COALESCE(s.fundraise_pct, 0::numeric) > 0::numeric THEN
                  CASE WHEN s.fundraise_round THEN ceil(wp.retail_price * s.fundraise_pct / 100.0)::numeric
                       ELSE round(wp.retail_price * s.fundraise_pct / 100.0, 2) END
                WHEN COALESCE(s.fundraise_flat, 0::numeric) > 0::numeric THEN
                  CASE WHEN s.fundraise_round THEN ceil(s.fundraise_flat)::numeric
                       ELSE s.fundraise_flat END
                ELSE 0::numeric
              END
            ELSE 0::numeric
          END AS amt) fr ON true
  WHERE wp.active = true;
