-- 066 · Link a package component to a specific in-store item.
--
-- webstore_bundle_items.webstore_product_id points at the exact webstore_products
-- row a package component came from, so the package shows that item's customized
-- photo / decoration / color rather than the generic base catalog product.
--   NULL → legacy rows or a "search all products" pick → resolve by product_id.

ALTER TABLE webstore_bundle_items
  ADD COLUMN IF NOT EXISTS webstore_product_id uuid REFERENCES webstore_products(id) ON DELETE SET NULL;
