-- Add in-house inventory for JX4468 (13/XS, 15/S, 12/M, 3/L, 2/XL)
-- Run this in Supabase SQL Editor or via supabase db push

BEGIN;

-- 1. Ensure product exists (if not already in the catalog)
-- If JX4468 already exists, this will be a no-op
INSERT INTO products (sku, name, brand, vendor_id, cost_nsa, nsa_cost, available_sizes, color)
VALUES (
  'JX4468',
  'JX4468 In-House Stock',
  'In-House',
  NULL,  -- No vendor (in-house)
  0,
  0,
  'XS,S,M,L,XL',
  'Stock'
)
ON CONFLICT (sku) DO NOTHING;

-- 2. Get product ID
WITH prod AS (
  SELECT id FROM products WHERE sku = 'JX4468'
)

-- 3. Ensure product variants exist for each size
INSERT INTO product_variants (product_id, size, sku)
SELECT
  prod.id,
  size,
  'JX4468-' || size
FROM prod,
(SELECT 'XS' as size UNION SELECT 'S' UNION SELECT 'M' UNION SELECT 'L' UNION SELECT 'XL') sizes
ON CONFLICT (sku) DO NOTHING;

-- 4. Update inventory with provided quantities
WITH prod AS (
  SELECT id FROM products WHERE sku = 'JX4468'
),
variants_data AS (
  SELECT pv.id as variant_id, pv.size, qty
  FROM product_variants pv
  JOIN prod ON pv.product_id = prod.id
  JOIN (
    SELECT 'XS' as size, 13 as qty UNION ALL
    SELECT 'S', 15 UNION ALL
    SELECT 'M', 12 UNION ALL
    SELECT 'L', 3 UNION ALL
    SELECT 'XL', 2
  ) qtys ON pv.size = qtys.size
)
INSERT INTO inventory (variant_id, qty_available)
SELECT variant_id, qty FROM variants_data
ON CONFLICT (variant_id) DO UPDATE SET qty_available = EXCLUDED.qty_available;

-- 5. Create audit log entries
WITH prod AS (
  SELECT id FROM products WHERE sku = 'JX4468'
),
variants_data AS (
  SELECT pv.id as variant_id, pv.size, qty
  FROM product_variants pv
  JOIN prod ON pv.product_id = prod.id
  JOIN (
    SELECT 'XS' as size, 13 as qty UNION ALL
    SELECT 'S', 15 UNION ALL
    SELECT 'M', 12 UNION ALL
    SELECT 'L', 3 UNION ALL
    SELECT 'XL', 2
  ) qtys ON pv.size = qtys.size
)
INSERT INTO inventory_adjustments (variant_id, adjustment_type, qty_change, reason, performed_by)
SELECT
  variant_id,
  'manual',
  qty,
  'Initial in-house inventory load for JX4468',
  (SELECT id FROM user_profiles WHERE role = 'admin' LIMIT 1)
FROM variants_data;

COMMIT;
