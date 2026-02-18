-- ============================================================
-- NSA OPERATIONS PORTAL — DATABASE SCHEMA
-- Phase 1: Foundation
-- Run this in Supabase SQL Editor (supabase.com → your project → SQL Editor)
-- ============================================================

-- USERS & ROLES
-- Supabase Auth handles login. This table adds role info.
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'rep', 'csr', 'artist', 'production', 'warehouse')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read all profiles" ON user_profiles FOR SELECT USING (true);
CREATE POLICY "Admins can manage profiles" ON user_profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- CUSTOMERS (Parent / Sub-Customer)
-- ============================================================
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES customers(id) ON DELETE SET NULL,  -- NULL = parent customer
  name TEXT NOT NULL,                     -- "Orange Lutheran High School" or "OLu Baseball"
  alpha_tag TEXT,                          -- "OLu", "OLuB", "SFL" — used in PO naming
  
  -- Contact
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  
  -- Addresses
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
  
  -- Pricing
  pricing_tier TEXT DEFAULT 'B' CHECK (pricing_tier IN ('A', 'B', 'C', 'custom')),
  custom_multiplier DECIMAL(4,2),         -- e.g., 1.6 for cost × 1.6
  
  -- Tax (auto-populated from Avalara based on shipping address)
  tax_rate DECIMAL(6,4),                  -- e.g., 0.0775 for 7.75%
  tax_exempt BOOLEAN DEFAULT false,
  
  -- Relationships
  primary_rep_id UUID REFERENCES user_profiles(id),
  
  -- QB Sync
  qb_customer_id TEXT,                    -- QuickBooks Online customer ID
  
  -- Meta
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customers_parent ON customers(parent_id);
CREATE INDEX idx_customers_alpha ON customers(alpha_tag);
CREATE INDEX idx_customers_rep ON customers(primary_rep_id);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read customers" ON customers FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Reps, CSRs, Admins can manage customers" ON customers FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'rep', 'csr'))
);

-- ============================================================
-- VENDORS
-- ============================================================
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                     -- "SanMar", "Adidas", "S&S Activewear"
  vendor_type TEXT NOT NULL CHECK (vendor_type IN ('api', 'upload')),
  api_provider TEXT,                      -- 'sanmar', 'ss_activewear', 'momentec', 'a4', null
  
  -- Contact
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  
  -- Account info (encrypted in production)
  account_number TEXT,
  api_key TEXT,
  api_username TEXT,
  api_password TEXT,
  
  -- Settings
  nsa_carries_inventory BOOLEAN DEFAULT false,  -- true for Adidas, UA
  click_automation BOOLEAN DEFAULT false,        -- true for Adidas
  invoice_scan_enabled BOOLEAN DEFAULT false,    -- true for Adidas, UA
  
  -- QB Sync
  qb_vendor_id TEXT,
  
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read vendors" ON vendors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage vendors" ON vendors FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- PRODUCTS (Parent SKU with size variants)
-- ============================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID REFERENCES vendors(id),
  
  -- Identity
  sku TEXT NOT NULL,                       -- "JX4453" — parent SKU for style+color
  name TEXT NOT NULL,                      -- "Adidas Unisex Pregame Tee"
  brand TEXT,                              -- "Adidas", "Under Armour", "Port Authority"
  color TEXT,                              -- "Team Power Red/White"
  category TEXT,                           -- "Tees", "Hoodies", "Hats", "Shorts", "Polos"
  
  -- Pricing
  retail_price DECIMAL(10,2),             -- MSRP / retail — for Adidas/UA tier pricing
  nsa_cost DECIMAL(10,2),                 -- our cost from vendor — NEVER shown to customer
  
  -- Available sizes for this product (defines the matrix)
  available_sizes TEXT[] DEFAULT '{"XS","S","M","L","XL","2XL","3XL","4XL"}',
  
  -- Images
  image_front_url TEXT,
  image_back_url TEXT,
  
  -- Vendor reference
  vendor_sku TEXT,                         -- vendor's own SKU if different
  upc TEXT,                               -- barcode / UPC
  
  -- QB
  qb_item_id TEXT,
  
  -- Meta
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_brand ON products(brand);
CREATE INDEX idx_products_name ON products USING gin(to_tsvector('english', name));  -- full text search

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read products" ON products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage products" ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- PRODUCT VARIANTS (individual size SKUs)
-- Auto-generated from parent product + available_sizes
-- ============================================================
CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,                      -- "XS", "S", "M", etc.
  sku TEXT NOT NULL,                       -- "JX4453-S", "JX4453-M" etc.
  barcode TEXT,                            -- UPC barcode for scanning
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_variants_sku ON product_variants(sku);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variants_barcode ON product_variants(barcode);

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read variants" ON product_variants FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage variants" ON product_variants FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- INVENTORY
-- ============================================================
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  
  -- Quantities
  qty_available INTEGER NOT NULL DEFAULT 0,    -- on shelf, ready to pull
  qty_allocated INTEGER NOT NULL DEFAULT 0,    -- pulled for orders, not yet shipped
  
  -- Location
  bin_location TEXT,                            -- "A-12-3" — where in warehouse
  
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX idx_inventory_variant ON inventory(variant_id);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read inventory" ON inventory FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin and warehouse can manage inventory" ON inventory FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'warehouse'))
);

-- ============================================================
-- INVENTORY ADJUSTMENTS (audit log)
-- ============================================================
CREATE TABLE inventory_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('manual', 'receiving', 'pull', 'return', 'correction')),
  qty_change INTEGER NOT NULL,             -- positive = add, negative = remove
  reason TEXT,                             -- required for manual adjustments
  reference_type TEXT,                     -- 'po', 'so', 'pick_ticket', null
  reference_id UUID,                       -- PO or SO id
  performed_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_adjustments_variant ON inventory_adjustments(variant_id);
CREATE INDEX idx_adjustments_date ON inventory_adjustments(created_at);

ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read adjustments" ON inventory_adjustments FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin and warehouse can create adjustments" ON inventory_adjustments FOR INSERT USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'warehouse'))
);

-- ============================================================
-- DECORATION PRICE MATRICES
-- ============================================================
CREATE TABLE decoration_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                      -- "Screen Print", "Embroidery", "Heat Transfer"
  code TEXT NOT NULL UNIQUE,               -- "screen_print", "embroidery", "heat_transfer"
  is_active BOOLEAN DEFAULT true
);

INSERT INTO decoration_types (name, code) VALUES
  ('Screen Print', 'screen_print'),
  ('Embroidery', 'embroidery'),
  ('Heat Transfer', 'heat_transfer');

CREATE TABLE price_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decoration_type_id UUID NOT NULL REFERENCES decoration_types(id),
  tier_name TEXT NOT NULL,                 -- "1 Color", "2 Color", "Up to 5K stitches"
  tier_sort INTEGER DEFAULT 0,             -- for ordering
  qty_min INTEGER NOT NULL,                -- 1, 12, 25, 50, 100
  qty_max INTEGER,                         -- 11, 24, 49, 99, null (unlimited)
  price_per_piece DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_matrix_type ON price_matrix(decoration_type_id);

ALTER TABLE decoration_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_matrix ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read deco types" ON decoration_types FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can read price matrix" ON price_matrix FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage deco types" ON decoration_types FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can manage price matrix" ON price_matrix FOR ALL USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_inventory_updated BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tr_user_profiles_updated BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to calculate customer price based on tier
CREATE OR REPLACE FUNCTION calculate_customer_price(
  p_retail_price DECIMAL,
  p_nsa_cost DECIMAL,
  p_pricing_tier TEXT,
  p_custom_multiplier DECIMAL,
  p_vendor_type TEXT  -- 'adidas_ua' or 'other'
) RETURNS DECIMAL AS $$
BEGIN
  IF p_vendor_type = 'adidas_ua' THEN
    -- Price off retail with discount
    RETURN CASE p_pricing_tier
      WHEN 'A' THEN p_retail_price * 0.60  -- 40% off retail
      WHEN 'B' THEN p_retail_price * 0.65  -- 35% off retail
      WHEN 'C' THEN p_retail_price * 0.70  -- 30% off retail
      WHEN 'custom' THEN p_retail_price * (1 - COALESCE(p_custom_multiplier, 0.35))
      ELSE p_retail_price * 0.65
    END;
  ELSE
    -- Price off cost with multiplier
    RETURN CASE p_pricing_tier
      WHEN 'custom' THEN p_nsa_cost * COALESCE(p_custom_multiplier, 1.6)
      ELSE p_nsa_cost * 1.6  -- default multiplier
    END;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- SAMPLE DATA (for testing)
-- ============================================================

-- Note: User profiles are created when users sign up via Supabase Auth
-- We'll insert test data for customers, vendors, products

-- Vendors
INSERT INTO vendors (name, vendor_type, api_provider, nsa_carries_inventory, click_automation, invoice_scan_enabled) VALUES
  ('Adidas', 'upload', NULL, true, true, true),
  ('Under Armour', 'upload', NULL, true, false, true),
  ('SanMar', 'api', 'sanmar', false, false, false),
  ('S&S Activewear', 'api', 'ss_activewear', false, false, false),
  ('Richardson', 'upload', NULL, false, false, false),
  ('Rawlings', 'upload', NULL, false, false, false),
  ('Badger', 'upload', NULL, false, false, false);

-- ============================================================
-- STORAGE BUCKETS (run in Supabase Dashboard → Storage)
-- ============================================================
-- Create these buckets in the Supabase dashboard:
-- 1. "artwork" — mockups, separations, embroidery files
-- 2. "product-images" — product photos
-- 3. "documents" — estimates, invoices, tech sheets PDFs
-- 4. "imports" — CSV upload staging
