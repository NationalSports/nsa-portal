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
  _toks TEXT[] := CASE WHEN COALESCE(p_query,'') = '' THEN '{}'::TEXT[]
                       ELSE regexp_split_to_array(lower(trim(p_query)), '\s+') END;
BEGIN
  -- Build a per-row haystack (own name/alpha_tag/tags + parent's tags) and require
  -- every whitespace-delimited query token to appear somewhere in it. This lets a
  -- search like "FPU baseball" match a sub-account named "Fresno Pacific Baseball"
  -- whose parent has the tag "FPU".
  WITH base AS (
    SELECT c.*,
      lower(coalesce(c.name,'') || ' ' || coalesce(c.alpha_tag,'') || ' '
            || array_to_string(coalesce(c.search_tags,'{}'::TEXT[]),' ') || ' '
            || array_to_string(coalesce(p.search_tags,'{}'::TEXT[]),' ')) AS hay
    FROM customers c
    LEFT JOIN customers p ON p.id = c.parent_id
  ), filt AS (
    SELECT b.*
    FROM base b
    WHERE (cardinality(_toks) = 0 OR NOT EXISTS (
            SELECT 1 FROM unnest(_toks) t WHERE b.hay NOT LIKE '%' || t || '%'))
      AND (p_rep_id IS NULL OR p_rep_id = 'all' OR b.primary_rep_id = p_rep_id)
      AND (p_active_only = FALSE OR b.is_active IS NOT FALSE)
  )
  SELECT count(*) INTO _total FROM filt;

  RETURN QUERY
  SELECT
    f.id, f.parent_id, f.name, f.alpha_tag, COALESCE(f.search_tags,'{}'::TEXT[]),
    f.adidas_ua_tier, f.catalog_markup, f.payment_terms,
    f.tax_rate, f.tax_exempt, f.primary_rep_id,
    f.billing_address_line1, f.billing_address_line2,
    f.billing_city, f.billing_state, f.billing_zip,
    f.shipping_address_line1, f.shipping_address_line2,
    f.shipping_city, f.shipping_state, f.shipping_zip,
    f.alt_billing_addresses, f.art_files,
    f.pantone_colors, f.thread_colors,
    f.notes, f.is_active, f.netsuite_internal_id,
    f.created_at, f.updated_at, f._version,
    _total AS total_count
  FROM (
    SELECT c.*,
      lower(coalesce(c.name,'') || ' ' || coalesce(c.alpha_tag,'') || ' '
            || array_to_string(coalesce(c.search_tags,'{}'::TEXT[]),' ') || ' '
            || array_to_string(coalesce(p.search_tags,'{}'::TEXT[]),' ')) AS hay
    FROM customers c
    LEFT JOIN customers p ON p.id = c.parent_id
  ) f
  WHERE (cardinality(_toks) = 0 OR NOT EXISTS (
          SELECT 1 FROM unnest(_toks) t WHERE f.hay NOT LIKE '%' || t || '%'))
    AND (p_rep_id IS NULL OR p_rep_id = 'all' OR f.primary_rep_id = p_rep_id)
    AND (p_active_only = FALSE OR f.is_active IS NOT FALSE)
  ORDER BY f.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION search_customers TO authenticated, anon;
