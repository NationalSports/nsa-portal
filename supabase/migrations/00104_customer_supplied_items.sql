-- Customer-supplied items: garments the customer buys and ships in for decoration only.
-- These are added to estimates/SOs at $0 — NSA charges for decoration, not the garment.
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS customer_supplied BOOLEAN DEFAULT FALSE;
ALTER TABLE so_items ADD COLUMN IF NOT EXISTS customer_supplied BOOLEAN DEFAULT FALSE;
