-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 016: per-item number/name personalization
-- PURELY ADDITIVE — ADD COLUMN + CREATE OR REPLACE VIEW.
-- Package components (and single catalog rows) can require a jersey number
-- and/or an optional custom name, with an optional name upcharge.
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN ALTER TABLE webstore_bundle_items ADD COLUMN takes_name BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_bundle_items ADD COLUMN name_upcharge NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN takes_number BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN takes_name BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN name_upcharge NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
-- View recreated to append takes_number/takes_name/name_upcharge (see app for full definition).
