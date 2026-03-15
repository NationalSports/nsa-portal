-- Decoration vendor management and pricing tables
-- Replaces hardcoded DECO_VENDORS array with DB-managed vendors + pricing matrices

CREATE TABLE IF NOT EXISTS deco_vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

ALTER TABLE deco_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON deco_vendors FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS deco_vendor_pricing (
  id SERIAL PRIMARY KEY,
  deco_vendor_id TEXT NOT NULL REFERENCES deco_vendors(id) ON DELETE CASCADE,
  deco_type TEXT NOT NULL,
  pricing_tiers JSONB NOT NULL DEFAULT '{"tiers":[]}',
  upcharges JSONB DEFAULT '{}',
  updated_at TEXT
);

ALTER TABLE deco_vendor_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON deco_vendor_pricing FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE deco_vendors; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE deco_vendor_pricing; EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Seed existing hardcoded deco vendors
INSERT INTO deco_vendors (id, name, is_active, created_at) VALUES
  ('dv_silver_screen', 'Silver Screen', true, NOW()::TEXT),
  ('dv_olympic_embroidery', 'Olympic Embroidery', true, NOW()::TEXT),
  ('dv_weprintit', 'WePrintIt', true, NOW()::TEXT),
  ('dv_pacific_screen', 'Pacific Screen Print', true, NOW()::TEXT)
ON CONFLICT (id) DO NOTHING;
