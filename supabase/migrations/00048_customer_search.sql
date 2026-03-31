-- ============================================================
-- Migration 00048: Customer Server-Side Search
-- GIN trigram indexes + search_customers RPC (paginated)
-- ============================================================

-- 1. GIN trigram indexes on customers for fast ILIKE queries
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_alpha_tag_trgm ON customers USING gin (alpha_tag gin_trgm_ops);

-- 2. Server-side customer search RPC (paginated, filtered by rep access)
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
  pricing_tier TEXT,
  custom_multiplier NUMERIC,
  tax_rate NUMERIC,
  tax_exempt BOOLEAN,
  primary_rep_id TEXT,
  billing_address JSONB,
  shipping_addresses JSONB,
  notes TEXT,
  is_active BOOLEAN,
  qb_customer_id TEXT,
  art_files JSONB,
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
    c.id, c.parent_id, c.name, c.alpha_tag, c.pricing_tier,
    c.custom_multiplier, c.tax_rate, c.tax_exempt, c.primary_rep_id,
    c.billing_address, c.shipping_addresses, c.notes, c.is_active,
    c.qb_customer_id, c.art_files,
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

-- 3. Grant execute
GRANT EXECUTE ON FUNCTION search_customers TO authenticated, anon;
