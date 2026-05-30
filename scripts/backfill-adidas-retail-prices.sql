-- =====================================================================
-- Backfill missing retail_price on Adidas-family products.
--
-- WHY: When promo dollars are applied, garments sell at retail_price.
-- If retail_price is missing (NULL or 0) the promo math silently falls
-- back to nsa_cost * 2 (see calcPromoItemSell in src/businessLogic.js),
-- which under-prices Adidas items and mis-bills promo coverage.
-- SO-1106 (JY5254) surfaced this: cost 63.75 with no retail produced
-- 127.50 instead of the true 170.00.
--
-- SCOPE: Of 6,299 products only 9 had a cost but no retail; of those
-- only the Adidas-family items have a deterministic cost->retail rule.
-- Adidas wholesale cost is 0.375 of retail (apparel), so:
--   retail = nsa_cost / 0.375  ==  nsa_cost * 8/3
-- Verified: 63.75 / 0.375 = 170, 52.50 / 0.375 = 140, 41.25 / 0.375 = 110.
--
-- Non-Adidas gaps (Champro, Mueller, Wilson, generic UA boonie) have no
-- cost->retail rule in the app and are intentionally left alone — for
-- those the nsa_cost * 2 promo fallback is the intended behavior.
--
-- APPLIED 2026-05-29 — 3 product rows + matching open so_items.
-- Idempotent: WHERE guards skip any row that already has a retail_price.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Products — set retail from the Adidas cost multiplier (cost / 0.375)
-- ---------------------------------------------------------------------
UPDATE products
SET retail_price = ROUND((nsa_cost / 0.375)::numeric, 2)
WHERE sku IN ('JY5254', 'KX3830', 'KX3836')
  AND brand IN ('Adidas', 'Adidas Golf')
  AND (retail_price IS NULL OR retail_price = 0)
  AND nsa_cost > 0;

-- ---------------------------------------------------------------------
-- 2. so_items — backfill the same retail onto line items that copied the
--    missing value, so already-open orders price promo correctly.
-- ---------------------------------------------------------------------
UPDATE so_items si
SET retail_price = p.retail_price
FROM products p
WHERE si.sku = p.sku
  AND p.sku IN ('JY5254', 'KX3830', 'KX3836')
  AND (si.retail_price IS NULL OR si.retail_price = 0)
  AND p.retail_price > 0;

COMMIT;

-- ---------------------------------------------------------------------
-- Verification (run after commit):
--   SELECT sku, brand, nsa_cost, retail_price
--   FROM products WHERE sku IN ('JY5254','KX3830','KX3836') ORDER BY sku;
-- Expected: JY5254=170.00, KX3830=140.00, KX3836=110.00
-- ---------------------------------------------------------------------
