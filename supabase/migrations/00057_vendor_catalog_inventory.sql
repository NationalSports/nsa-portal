-- Add optional inventory tracking for vendor catalog items.
-- Most catalog items are order-only (no stock), but some (e.g. Under Armour)
-- may have a few pieces in inventory.

ALTER TABLE vendor_catalog_items ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN DEFAULT false;

-- Per-size inventory for catalog items that opt in to tracking
CREATE TABLE IF NOT EXISTS vendor_catalog_inventory (
  id SERIAL PRIMARY KEY,
  catalog_item_id INTEGER REFERENCES vendor_catalog_items(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  quantity INTEGER DEFAULT 0,
  alert_threshold INTEGER,
  UNIQUE(catalog_item_id, size)
);

CREATE INDEX IF NOT EXISTS idx_vci_inv_item ON vendor_catalog_inventory(catalog_item_id);

-- RLS
ALTER TABLE vendor_catalog_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendor_catalog_inventory_all" ON vendor_catalog_inventory FOR ALL USING (true) WITH CHECK (true);
