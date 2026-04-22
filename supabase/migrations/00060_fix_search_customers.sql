-- ============================================================
-- Migration 00060: Fix search_customers RPC column references
-- ============================================================
-- The original RPC (00048) referenced columns that don't exist on the
-- customers table (pricing_tier, custom_multiplier, billing_address,
-- shipping_addresses, qb_customer_id). Every call errored with
-- "column c.pricing_tier does not exist", silently breaking the
-- customer search dropdown.
--
-- Rewrite the function against the actual schema: adidas_ua_tier,
-- catalog_markup, payment_terms, and the split billing/shipping
-- address columns.

-- Drop first because the RETURNS TABLE signature changes; Postgres
-- won't let CREATE OR REPLACE alter the output row type.
DROP FUNCTION IF EXISTS search_customers(text, text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION search_customers(
  p_query TEXT DEFAULT NULL,
  p_rep_id TEXT DEFAULT NULL,
  p_active_only BOOLEAN DEFAULT TRUE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  parent_id TEXT,
  name TEXT,
  alpha_tag TEXT,
  adidas_ua_tier TEXT,
  catalog_markup NUMERIC,
  payment_terms TEXT,
  tax_rate NUMERIC,
  tax_exempt BOOLEAN,
  primary_rep_id TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  shipping_address_line1 TEXT,
  shipping_address_line2 TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_zip TEXT,
  alt_billing_addresses JSONB,
  art_files JSONB,
  pantone_colors JSONB,
  thread_colors JSONB,
  notes TEXT,
  is_active BOOLEAN,
  netsuite_internal_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  _version INT,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  _total BIGINT;
BEGIN
  SELECT count(*) INTO _total
  FROM customers c
  WHERE (p_query IS NULL OR p_query = '' OR
         c.name ILIKE '%' || p_query || '%' OR
         c.alpha_tag ILIKE '%' || p_query || '%')
    AND (p_rep_id IS NULL OR p_rep_id = 'all' OR c.primary_rep_id = p_rep_id)
    AND (p_active_only = FALSE OR c.is_active IS NOT FALSE);

  RETURN QUERY
  SELECT
    c.id, c.parent_id, c.name, c.alpha_tag,
    c.adidas_ua_tier, c.catalog_markup, c.payment_terms,
    c.tax_rate, c.tax_exempt, c.primary_rep_id,
    c.billing_address_line1, c.billing_address_line2,
    c.billing_city, c.billing_state, c.billing_zip,
    c.shipping_address_line1, c.shipping_address_line2,
    c.shipping_city, c.shipping_state, c.shipping_zip,
    c.alt_billing_addresses, c.art_files,
    c.pantone_colors, c.thread_colors,
    c.notes, c.is_active, c.netsuite_internal_id,
    c.created_at, c.updated_at, c._version,
    _total AS total_count
  FROM customers c
  WHERE (p_query IS NULL OR p_query = '' OR
         c.name ILIKE '%' || p_query || '%' OR
         c.alpha_tag ILIKE '%' || p_query || '%')
    AND (p_rep_id IS NULL OR p_rep_id = 'all' OR c.primary_rep_id = p_rep_id)
    AND (p_active_only = FALSE OR c.is_active IS NOT FALSE)
  ORDER BY c.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION search_customers TO authenticated, anon;
