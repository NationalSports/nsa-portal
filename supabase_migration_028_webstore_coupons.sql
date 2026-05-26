-- Migration 028: coupon / scholarship codes for webstores.
CREATE TABLE IF NOT EXISTS webstore_coupons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'percent',
  value       NUMERIC DEFAULT 0,
  max_uses    INT,
  used_count  INT DEFAULT 0,
  active      BOOLEAN DEFAULT true,
  batch_label TEXT,
  expires_at  DATE,
  created_at  TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS webstore_coupons_store_code ON webstore_coupons(store_id, lower(code));
ALTER TABLE webstore_coupons ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_coupons FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN coupon_code TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN discount_amt NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
