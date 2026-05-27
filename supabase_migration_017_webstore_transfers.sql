-- Migration 017: Heat-transfer inventory per store + per-item transfer marking.
-- design = one deducted per item purchased; number = one digit, deducted per
-- occurrence in a player number. PURELY ADDITIVE.
CREATE TABLE IF NOT EXISTS webstore_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  code TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'design',
  on_hand INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, code)
);
CREATE INDEX IF NOT EXISTS idx_webstore_transfers_store ON webstore_transfers(store_id);
ALTER TABLE webstore_transfers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_transfers FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN transfer_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_bundle_items ADD COLUMN transfer_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
