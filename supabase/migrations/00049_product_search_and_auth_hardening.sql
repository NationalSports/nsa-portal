-- ============================================================
-- Migration 00047: Product Search & Auth Hardening
-- 1. GIN trigram index for fast ILIKE product search
-- 2. Server-side product search RPC function (paginated)
-- 3. Optimistic locking via version column on key tables
-- 4. Auth helper: map Supabase Auth user to team_member
-- ============================================================

-- 1. Enable pg_trgm extension for fast fuzzy/substring search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Create GIN trigram indexes on products for fast ILIKE queries
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_sku_trgm ON products USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON products USING gin (brand gin_trgm_ops);

-- 3. Server-side product search RPC (paginated, filtered)
CREATE OR REPLACE FUNCTION search_products(
  p_query TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_vendor_id TEXT DEFAULT NULL,
  p_color_category TEXT DEFAULT NULL,
  p_in_stock BOOLEAN DEFAULT FALSE,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  vendor_id TEXT,
  sku TEXT,
  name TEXT,
  brand TEXT,
  color TEXT,
  color_category TEXT,
  category TEXT,
  retail_price NUMERIC,
  nsa_cost NUMERIC,
  is_active BOOLEAN,
  available_sizes JSONB,
  _colors JSONB,
  image_url TEXT,
  image_front_url TEXT,
  image_back_url TEXT,
  images JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  _total BIGINT;
BEGIN
  -- Count total matching rows (for pagination metadata)
  SELECT count(*) INTO _total
  FROM products pr
  LEFT JOIN product_inventory pi ON pi.product_id = pr.id
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
    ));

  RETURN QUERY
  SELECT
    pr.id, pr.vendor_id, pr.sku, pr.name, pr.brand, pr.color,
    pr.color_category, pr.category, pr.retail_price, pr.nsa_cost,
    pr.is_active, pr.available_sizes, pr._colors,
    COALESCE(pr.image_url, pr.image_front_url, '') AS image_url,
    pr.image_front_url,
    COALESCE(pr.image_back_url, pr.image_back_url, '') AS image_back_url,
    COALESCE(pr.images, '[]'::JSONB) AS images,
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
  ORDER BY pr.name
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 4. Optimistic locking: add version columns to key tables
-- (only if they don't already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='estimates' AND column_name='_version') THEN
    ALTER TABLE estimates ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales_orders' AND column_name='_version') THEN
    ALTER TABLE sales_orders ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='_version') THEN
    ALTER TABLE customers ADD COLUMN _version INT NOT NULL DEFAULT 1;
  END IF;
END$$;

-- 5. Trigger to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW._version := COALESCE(OLD._version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_estimates_version') THEN
    CREATE TRIGGER trg_estimates_version BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sales_orders_version') THEN
    CREATE TRIGGER trg_sales_orders_version BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_version') THEN
    CREATE TRIGGER trg_customers_version BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION increment_version();
  END IF;
END$$;

-- 6. Add auth_id column to team_members if not present (links to Supabase Auth)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_members' AND column_name='auth_id') THEN
    ALTER TABLE team_members ADD COLUMN auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='team_members' AND column_name='password_set') THEN
    ALTER TABLE team_members ADD COLUMN password_set BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END$$;

-- 7. RPC to look up team member by auth JWT
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS SETOF team_members
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT * FROM team_members WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- 8. RPC to link a team member to their Supabase Auth account (admin only)
CREATE OR REPLACE FUNCTION link_team_auth(p_team_id TEXT, p_auth_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE team_members SET auth_id = p_auth_id, password_set = TRUE WHERE id = p_team_id;
END;
$$;

-- 9. Grant execute on RPC functions to authenticated and anon roles
GRANT EXECUTE ON FUNCTION search_products TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_my_profile TO authenticated;
GRANT EXECUTE ON FUNCTION link_team_auth TO authenticated;
