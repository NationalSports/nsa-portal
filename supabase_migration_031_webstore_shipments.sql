-- Migration 031: shipment records from ShipStation (one row per shipment;
-- supports partial shipments) + shipped_at on the order.
CREATE TABLE IF NOT EXISTS webstore_shipments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID REFERENCES webstore_orders(id) ON DELETE CASCADE,
  store_id        UUID,
  tracking_number TEXT UNIQUE,
  carrier         TEXT,
  service         TEXT,
  ship_date       DATE,
  items           JSONB DEFAULT '[]',
  emailed         BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE webstore_shipments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_shipments FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN shipped_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
