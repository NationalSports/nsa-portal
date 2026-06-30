-- Per-size price upcharge on the storefront (2XL/3XL+ cost more).
--
-- Vendors (SanMar, S&S, Momentec) charge more for bigger sizes; that size-tiered
-- cost is captured into products.size_costs. This migration turns that cost
-- difference into a shopper-facing upcharge:
--   • adds webstores.size_upcharge_enabled (default true) — a per-store off switch.
--   • adds webstore_storefront_products.size_upcharges — a {size: extra_dollars}
--     map computed from products.size_costs vs products.nsa_cost (the base/standard
--     cost). The extra is the cost difference, rounded up to the whole dollar, and
--     only for sizes that actually cost more. NULL when the store has it off, the
--     product has no per-size cost, or no size runs pricier.
--
-- The storefront adds size_upcharges[selectedSize] to the displayed price, and
-- netlify/functions/webstore-checkout re-reads the same map server-side so the
-- charged price always matches what the shopper saw. Only the price DELTA is
-- exposed (never the raw garment cost). Fully additive and gated: existing stores
-- are unaffected until size_costs populates, and a rep can switch it off per store.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS size_upcharge_enabled boolean NOT NULL DEFAULT true;

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
    COALESCE(wp.image_back_url, p.image_back_url) AS image_back_url,
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
    wp.decorations,
    CASE
      WHEN COALESCE(s.size_upcharge_enabled, true)
           AND p.nsa_cost IS NOT NULL AND p.nsa_cost > 0::numeric
           AND p.size_costs IS NOT NULL
      THEN ( SELECT jsonb_object_agg(e.key, GREATEST(0, ceil((e.value #>> '{}')::numeric - p.nsa_cost))::int)
               FROM jsonb_each(p.size_costs) e
              WHERE jsonb_typeof(e.value) = 'number'
                AND (e.value #>> '{}')::numeric > p.nsa_cost )
      ELSE NULL::jsonb
    END AS size_upcharges
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
