-- 067 · Decoration charge folded into a store item's price.
--
-- webstore_products.deco_upcharge is the flat dollar amount that has been added INTO
-- retail_price to cover decorating an otherwise-cheap garment (e.g. shorts). The item
-- editor's "Decoration charge" toggle bumps retail_price by this amount, so the whole
-- order / Sales Order / reporting pipeline keeps reading retail_price as the single
-- all-in price the shopper pays. We persist the slice only so the toggle survives a
-- reopen and so margin math knows the deco cost is already covered.
--   0 (default) → no decoration charge applied.

ALTER TABLE webstore_products
  ADD COLUMN IF NOT EXISTS deco_upcharge numeric NOT NULL DEFAULT 0;
