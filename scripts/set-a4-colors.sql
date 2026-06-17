-- ============================================================================
-- A4 garment colors -> products._colors
-- ============================================================================
-- The A4 price list carries no per-style color data, but A4 apparel shares a
-- standard solid-color palette. Populating products._colors enables the color
-- dropdown on order lines (OrderEditor.js renders it whenever a product has
-- _colors and the brand is not Adidas/UA/New Balance).
--
-- Colors vary by style (e.g. socks come in fewer); this applies A4's standard
-- palette so a color can always be picked. Idempotent.
-- ============================================================================
UPDATE products
SET _colors = '["White","Black","Graphite","Silver","Charcoal","Navy","Royal","Light Blue","Columbia Blue","Forest","Kelly","Lime","Maroon","Cardinal","Scarlet","Purple","Pink","Gold","Athletic Gold","Vegas Gold","Orange","Safety Orange","Safety Yellow","Texas Orange","Athletic Heather"]'::jsonb,
    updated_at = now()
WHERE vendor_id = 'ns_23';
