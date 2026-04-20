-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 006: NetSuite Internal ID on customers
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- Adds a permanent link from portal customers back to the NetSuite record
-- they were imported from. This lets future NetSuite imports (invoices, POs,
-- anything) join on a stable ID instead of fuzzy-matching on name.

DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN netsuite_internal_id TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_netsuite_internal_id
  ON customers(netsuite_internal_id)
  WHERE netsuite_internal_id IS NOT NULL;
