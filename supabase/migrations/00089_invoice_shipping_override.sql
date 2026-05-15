-- Per-invoice ship-to override (mirrors billing_name / billing_address pattern)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS shipping_address TEXT;
