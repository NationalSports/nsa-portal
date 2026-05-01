-- ============================================================
-- Migration 00085: Customer search_tags
-- ============================================================
-- Adds a multi-value alias column on customers so reps can attach
-- short search aliases (e.g. "FPU baseball" → Fresno Pacific
-- University Baseball, "WVC basketball" → West Valley College).
-- Tags on a parent are also matched when searching for sub-accounts
-- (handled in the app + in the search_customers RPC below).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS search_tags TEXT[] DEFAULT '{}'::TEXT[];

CREATE INDEX IF NOT EXISTS idx_customers_search_tags
  ON public.customers USING GIN (search_tags);

-- Rebuild search_customers to also match against search_tags, and to
-- match a sub-account when its parent has a matching tag.
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
  search_tags TEXT[],
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
SET search_path = public
AS $$
DECLARE
  _total BIGINT;
  _q TEXT := '%' || COALESCE(p_query, '') || '%';
BEGIN
  SELECT count(*) INTO _total
  FROM customers c
  LEFT JOIN customers p ON p.id = c.parent_id
  WHERE (p_query IS NULL OR p_query = '' OR
         c.name ILIKE _q OR
         c.alpha_tag ILIKE _q OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(c.search_tags,'{}'::TEXT[])) t WHERE t ILIKE _q) OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(p.search_tags,'{}'::TEXT[])) t WHERE t ILIKE _q))
    AND (p_rep_id IS NULL OR p_rep_id = 'all' OR c.primary_rep_id = p_rep_id)
    AND (p_active_only = FALSE OR c.is_active IS NOT FALSE);

  RETURN QUERY
  SELECT
    c.id, c.parent_id, c.name, c.alpha_tag, COALESCE(c.search_tags,'{}'::TEXT[]),
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
  LEFT JOIN customers p ON p.id = c.parent_id
  WHERE (p_query IS NULL OR p_query = '' OR
         c.name ILIKE _q OR
         c.alpha_tag ILIKE _q OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(c.search_tags,'{}'::TEXT[])) t WHERE t ILIKE _q) OR
         EXISTS (SELECT 1 FROM unnest(COALESCE(p.search_tags,'{}'::TEXT[])) t WHERE t ILIKE _q))
    AND (p_rep_id IS NULL OR p_rep_id = 'all' OR c.primary_rep_id = p_rep_id)
    AND (p_active_only = FALSE OR c.is_active IS NOT FALSE)
  ORDER BY c.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION search_customers TO authenticated, anon;
