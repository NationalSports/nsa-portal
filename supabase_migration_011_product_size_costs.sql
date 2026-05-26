-- Adds a per-size cost map to products so SanMar (and other vendors that
-- upcharge extended sizes like 2XL/3XL+) carry size-level pricing rather than
-- a single flat nsa_cost.
--
-- Shape: { "S": 4.36, "M": 4.36, "L": 4.36, "2XL": 5.36, "3XL": 6.36 }
--
-- Populated by netlify/functions/sanmar-pricing-sync.js (daily). nsa_cost
-- remains the base/min price for backward compatibility; size_costs holds the
-- full per-size breakdown. Consumed in src/OrderEditor.js as item._sizeCosts
-- at PO-creation time and flattened into the SanMar PromoStandards payload by
-- src/sanmarPO.js.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS size_costs JSONB;
