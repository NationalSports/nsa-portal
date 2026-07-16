-- ════════════════════════════════════════════════════════════════════════
-- CANONICAL definition of the webstore_storefront_products view.
--
-- This file is the SINGLE SOURCE OF TRUTH for the view. The public storefront
-- (src/storefront/Storefront.js) and the server checkout's stock guard
-- (netlify/functions/webstore-checkout.js → checkStock) both read it.
--
-- HOW TO CHANGE IT (read before editing — the view is easy to break):
--   1. Edit the SELECT below. It is CREATE OR REPLACE, so you may only APPEND
--      new columns (Postgres forbids reordering/removing/retyping columns of an
--      existing view). Add new output columns at the END of the select list.
--   2. Copy the full statement into a new numbered migration
--      (supabase_migration_0NN_*.sql) AND apply it to the project.
--   3. Keep this file and that migration identical. This file always reflects
--      the latest applied definition, so the next editor copies from HERE
--      instead of re-deriving it with pg_get_viewdef (which is how columns get
--      dropped by accident).
--
-- History of the columns/joins, newest last:
--   047  fundraise amount/display price        052  variant_group_id (color grouping)
--   053  store_category   054  vendor_size_eta  055/056  description (+ ai)
--   062  variant_label    064  vendor stock from inventory_unified (all vendors)
--   199  vendor stock matched on NORMALIZED sku (live-import vs sync spelling)
-- ════════════════════════════════════════════════════════════════════════

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
            WHEN COALESCE(s.size_upcharge_enabled, true) AND p.nsa_cost IS NOT NULL AND p.nsa_cost > 0::numeric AND p.size_costs IS NOT NULL THEN ( SELECT jsonb_object_agg(e.key, GREATEST(0::numeric, ceil(((e.value #>> '{}'::text[])::numeric) - p.nsa_cost))::integer) AS jsonb_object_agg
               FROM jsonb_each(p.size_costs) e(key, value)
              WHERE jsonb_typeof(e.value) = 'number'::text AND ((e.value #>> '{}'::text[])::numeric) > p.nsa_cost)
            ELSE NULL::jsonb
        END AS size_upcharges,
    wp.variant_group_id,
    wp.category AS store_category,
    av.vendor_size_eta,
    COALESCE(NULLIF(btrim(p.description_ai), ''::text), p.description) AS description,
    wp.variant_label,
    -- 068  per-item inventory tracking toggle (+ inventory_source so the storefront can
    -- tell a stock-backed item from a custom / made-to-order one).
    COALESCE(wp.track_inventory, true) AS track_inventory,
    p.inventory_source,
    -- 069  mandatory flag + kit grouping — hero auto-picks mandatory items first.
    COALESCE(wp.required, false) AS required,
    wp.kit_name,
    -- 070  card display style for bundle packages (null=card, 'banner', 'showcase').
    wp.card_style
   FROM webstore_products wp
     LEFT JOIN products p ON p.id = wp.product_id
     LEFT JOIN webstores s ON s.id = wp.store_id
     LEFT JOIN ( SELECT product_inventory.product_id,
            jsonb_object_agg(product_inventory.size, product_inventory.quantity) AS size_stock
           FROM product_inventory
          GROUP BY product_inventory.product_id) inv ON inv.product_id = wp.product_id
     LEFT JOIN webstore_product_eta eta_pid ON eta_pid.product_id = wp.product_id
     LEFT JOIN webstore_product_eta eta_sku ON eta_sku.product_id IS NULL AND eta_sku.sku = wp.sku
     -- Live vendor (drop-ship) stock + ETA for EVERY synced vendor. Matched on
     -- NORMALIZED sku (separators stripped, uppercased — the live import and the
     -- vendor syncs spell the same colorway differently; expression indexes on each
     -- vendor table serve the lookup, see migration 00199) AND source
     -- (= products.inventory_source) so a SKU that collides across brands can't
     -- pull the wrong vendor's stock.
     LEFT JOIN LATERAL ( SELECT jsonb_object_agg(ai.size, ai.stock_qty) AS vendor_size_stock,
            COALESCE(sum(GREATEST(ai.stock_qty, 0)), 0::bigint) AS vendor_on_hand,
            min(NULLIF(ai.future_delivery_date, ''::text)) FILTER (WHERE COALESCE(ai.stock_qty, 0) <= 0) AS vendor_eta,
            jsonb_object_agg(ai.size, ai.future_delivery_date) FILTER (WHERE COALESCE(ai.stock_qty, 0) <= 0 AND ai.future_delivery_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'::text) AS vendor_size_eta
           FROM inventory_unified ai
          WHERE regexp_replace(upper(ai.sku), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(wp.sku), '[^A-Z0-9]', '', 'g') AND ai.source = p.inventory_source AND (p.available_sizes IS NULL OR (ai.size IN ( SELECT jsonb_array_elements_text(p.available_sizes) AS jsonb_array_elements_text)) OR (
                CASE upper(ai.size)
                    WHEN 'ST'::text THEN 'S'::text
                    WHEN 'MT'::text THEN 'M'::text
                    WHEN 'LT'::text THEN 'L'::text
                    WHEN 'XLT'::text THEN 'XL'::text
                    WHEN 'XST'::text THEN 'XS'::text
                    WHEN '2XLT'::text THEN '2XL'::text
                    WHEN '3XLT'::text THEN '3XL'::text
                    WHEN '4XLT'::text THEN '4XL'::text
                    WHEN '5XLT'::text THEN '5XL'::text
                    ELSE NULL::text
                END IN ( SELECT jsonb_array_elements_text(p.available_sizes) AS jsonb_array_elements_text)))) av ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN COALESCE(wp.fundraise_amount, 0::numeric) > 0::numeric THEN wp.fundraise_amount
                    WHEN s.fundraise_enabled THEN
                    CASE
                        WHEN COALESCE(s.fundraise_pct, 0::numeric) > 0::numeric THEN
                        CASE
                            WHEN s.fundraise_round THEN ceil(wp.retail_price * s.fundraise_pct / 100.0)
                            ELSE round(wp.retail_price * s.fundraise_pct / 100.0, 2)
                        END
                        WHEN COALESCE(s.fundraise_flat, 0::numeric) > 0::numeric THEN
                        CASE
                            WHEN s.fundraise_round THEN ceil(s.fundraise_flat)
                            ELSE s.fundraise_flat
                        END
                        ELSE 0::numeric
                    END
                    ELSE 0::numeric
                END AS amt) fr ON true
  WHERE wp.active = true;
