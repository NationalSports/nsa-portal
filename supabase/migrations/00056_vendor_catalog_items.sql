-- Lightweight vendor catalog: stores commonly-used SKUs from vendors
-- that NSA doesn't carry inventory for (Richardson, New Balance, etc.)
-- These show up in estimate/SO product search but don't create inventory records.

CREATE TABLE IF NOT EXISTS vendor_catalog_items (
  id SERIAL PRIMARY KEY,
  vendor_id TEXT REFERENCES vendors(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  color TEXT,
  category TEXT,
  nsa_cost NUMERIC DEFAULT 0,
  retail_price NUMERIC DEFAULT 0,
  available_sizes JSONB DEFAULT '["S","M","L","XL","2XL"]',
  image_url TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vendor_id, sku, color)
);

-- Index for fast search by SKU/name/brand
CREATE INDEX IF NOT EXISTS idx_vci_sku ON vendor_catalog_items(sku);
CREATE INDEX IF NOT EXISTS idx_vci_search ON vendor_catalog_items USING gin (
  (sku || ' ' || name || ' ' || COALESCE(brand, '') || ' ' || COALESCE(color, '')) gin_trgm_ops
);
CREATE INDEX IF NOT EXISTS idx_vci_vendor ON vendor_catalog_items(vendor_id);

-- RLS
ALTER TABLE vendor_catalog_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_catalog_items_all" ON vendor_catalog_items FOR ALL USING (true) WITH CHECK (true);
