-- Migration 030: optional per-item ship weight (oz). Blank = auto-estimate by type.
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN weight_oz NUMERIC; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
