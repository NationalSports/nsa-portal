-- =====================================================================
-- Set all Adidas TABELA 23 jerseys to $25.00 retail.
--
-- WHY: Requested catalog price correction — the TABELA 23 jersey line
-- was carrying mixed retail prices ($35 / $40 / $45) across the standard,
-- W (women's) and Y (youth) cuts. The standard jersey (e.g. IB4928) was
-- showing $40 retail, which is incorrect; the whole line should be $25.
--
-- SCOPE: 27 products WHERE name ILIKE '%tabela%' AND category = 'Jersey'.
-- Two W-cut SKUs (H44530, H44531) were already $25 and are untouched.
-- The remaining 25 rows are moved to $25.
--
-- DERIVED PRICING: Tier A/B/C are computed from retail_price
-- (60% / 65% / 70% of retail — see price_for_tier in supabase-schema.sql),
-- so they recompute automatically to $15.00 / $16.25 / $17.50. No tier
-- columns are stored, so nothing else needs updating.
--
-- NO HISTORICAL IMPACT: At the time of change these SKUs appeared in
-- zero so_items, zero webstore_products, and zero webstore_order_items,
-- so no open orders or storefront listings are retroactively repriced.
--
-- NOTE: 8 SKUs cost $16.87 (H44526-H44529, HS0539, HS0540, IB4933,
-- IB4935). At $25 retail their Tier A ($15.00) and Tier B ($16.25) fall
-- below cost. This was confirmed as the intended price anyway.
--
-- APPLIED 2026-06-12 via Supabase — 25 product rows updated.
-- Idempotent: the retail_price IS DISTINCT FROM 25 guard skips rows
-- already at $25.
-- =====================================================================

BEGIN;

UPDATE products
SET retail_price = 25
WHERE name ILIKE '%tabela%'
  AND category = 'Jersey'
  AND retail_price IS DISTINCT FROM 25;

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (run after commit):
--   SELECT COUNT(*) AS total,
--          COUNT(*) FILTER (WHERE retail_price = 25) AS at_25
--   FROM products WHERE name ILIKE '%tabela%' AND category = 'Jersey';
-- Expected: total = 27, at_25 = 27
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ROLLBACK — restores the exact pre-change retail prices.
-- (H44530 / H44531 were already $25 and were never changed.)
-- ---------------------------------------------------------------------
-- BEGIN;
--   UPDATE products SET retail_price = 45 WHERE sku IN
--     ('H44526','H44527','H44528','H44529','HS0539','HS0540','IB4933','IB4935');
--   UPDATE products SET retail_price = 40 WHERE sku IN
--     ('H44532','H44533','H44534','H44535','H44536','H44537',
--      'IA9146','IA9147','IA9149','IA9150','IA9156','IA9157',
--      'IB4926','IB4928','IB4930','IB4931');
--   UPDATE products SET retail_price = 35 WHERE sku = 'HT6552';
-- COMMIT;
-- ---------------------------------------------------------------------
