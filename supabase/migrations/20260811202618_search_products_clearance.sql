-- Add is_clearance / clearance_cost to search_products' return shape. The order editor's
-- server-search fallback and the estimate assistant build order lines from this RPC's rows;
-- without these two columns those paths can't see clearance pricing, so a clearance item
-- added through them landed on the estimate/SO at full nsa_cost instead of the rep's
-- clearance cost. Query logic, filters, and ordering are unchanged from 00188 — only the
-- two columns are appended to the RETURNS TABLE (additive, existing callers unaffected).

DROP FUNCTION IF EXISTS public.search_products(text, text, text, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.search_products(p_query text, p_category text, p_vendor_id text, p_color_category text, p_in_stock boolean, p_limit integer, p_offset integer)
 RETURNS TABLE(id text, vendor_id text, sku text, name text, brand text, color text, color_category text, category text, retail_price numeric, nsa_cost numeric, is_active boolean, is_archived boolean, available_sizes jsonb, _colors jsonb, image_url text, image_front_url text, image_back_url text, images jsonb, pricing_group text, inventory_source text, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint, is_clearance boolean, clearance_cost numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    AND (pr.is_archived IS NOT TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM vendors ve
      WHERE ve.id = pr.vendor_id
        AND ve.api_provider IN ('sanmar', 'ss_activewear', 'momentec', 'richardson')
    );

  RETURN QUERY
  SELECT
    pr.id, pr.vendor_id, pr.sku, pr.name, pr.brand, pr.color,
    pr.color_category, pr.category, pr.retail_price, pr.nsa_cost,
    pr.is_active, pr.is_archived, pr.available_sizes, pr._colors,
    COALESCE(pr.image_front_url, '') AS image_url,
    pr.image_front_url,
    COALESCE(pr.image_back_url, '') AS image_back_url,
    '[]'::JSONB AS images,
    pr.pricing_group,
    pr.inventory_source,
    pr.created_at, pr.updated_at,
    _total AS total_count,
    pr.is_clearance,
    pr.clearance_cost
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
    AND NOT EXISTS (
      SELECT 1 FROM vendors ve
      WHERE ve.id = pr.vendor_id
        AND ve.api_provider IN ('sanmar', 'ss_activewear', 'momentec', 'richardson')
    )
  ORDER BY pr.name
  LIMIT p_limit OFFSET p_offset;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_products(text, text, text, text, boolean, integer, integer) TO anon, authenticated, service_role;
