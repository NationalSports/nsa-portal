-- Add _art_ids to so_jobs for multi-art job tracking
ALTER TABLE so_jobs ADD COLUMN IF NOT EXISTS _art_ids JSONB;

-- Add qb_invoice_id to invoices for QuickBooks sync
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_invoice_id TEXT;

-- Add tc_reported and tc_tax for tax compliance
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tc_reported BOOLEAN DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tc_tax NUMERIC;
