-- Add is_archived flag to products for hiding old/unused products without deletion
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

-- Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_products_is_archived ON products(is_archived);

-- Update search_products RPC to exclude archived products by default
DROP FUNCTION IF EXISTS search_products(text,text,text,text,boolean,integer,integer);

CREATE FUNCTION search_products(
  p_query TEXT,
  p_category TEXT,
  p_vendor_id TEXT,
  p_color_category TEXT,
  p_in_stock BOOLEAN,
  p_limit INT,
  p_offset INT
)
RETURNS TABLE(
  id TEXT, vendor_id TEXT, sku TEXT, name TEXT, brand TEXT, color TEXT,
  color_category TEXT, category TEXT, retail_price NUMERIC, nsa_cost NUMERIC,
  is_active BOOLEAN, is_archived BOOLEAN, available_sizes JSONB, _colors JSONB,
  image_url TEXT, image_front_url TEXT, image_back_url TEXT, images JSONB,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql AS $$
DECLARE
  _total BIGINT;
BEGIN
  SELECT count(*) INTO _total
  FROM products pr
  WHERE (p_query IS NULL OR p_query = '' OR
         pr.sku ILIKE '%' || p_query || '%' OR
         pr.name ILIKE '%' || p_query || '%' OR
         pr.brand ILIKE '%' || p_query || '%' OR
         pr.color ILIKE '%' || p_query || '%')
    AND (p_category IS NULL OR p_category = 'all' OR pr.category = p_category)
    AND (p_vendor_id IS NULL OR p_vendor_id = 'all' OR pr.vendor_id = p_vendor_id)
    AND (p_color_category IS NULL OR p_color_category = 'all' OR pr.color_category = p_color_category)
    AND (p_in_stock = FALSE OR EXISTS (
      SELECT 1 FROM product_inventory pi2
      WHERE pi2.product_id = pr.id AND pi2.quantity > 0
    ))
    AND (pr.is_archived IS NOT TRUE);

  RETURN QUERY
  SELECT
    pr.id, pr.vendor_id, pr.sku, pr.name, pr.brand, pr.color,
    pr.color_category, pr.category, pr.retail_price, pr.nsa_cost,
    pr.is_active, pr.is_archived, pr.available_sizes, pr._colors,
    COALESCE(pr.image_front_url, '') AS image_url,
    pr.image_front_url,
    COALESCE(pr.image_back_url, '') AS image_back_url,
    '[]'::JSONB AS images,
    pr.created_at, pr.updated_at,
    _total AS total_count
  FROM products pr
  WHERE (p_query IS NULL OR p_query = '' OR
         pr.sku ILIKE '%' || p_query || '%' OR
         pr.name ILIKE '%' || p_query || '%' OR
         pr.brand ILIKE '%' || p_query || '%' OR
         pr.color ILIKE '%' || p_query || '%')
    AND (p_category IS NULL OR p_category = 'all' OR pr.category = p_category)
    AND (p_vendor_id IS NULL OR p_vendor_id = 'all' OR pr.vendor_id = p_vendor_id)
    AND (p_color_category IS NULL OR p_color_category = 'all' OR pr.color_category = p_color_category)
    AND (p_in_stock = FALSE OR EXISTS (
      SELECT 1 FROM product_inventory pi2
      WHERE pi2.product_id = pr.id AND pi2.quantity > 0
    ))
    AND (pr.is_archived IS NOT TRUE)
  ORDER BY pr.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;
