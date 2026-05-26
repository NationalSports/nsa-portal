-- Migration 023: per-store shipping defaults for direct label PDFs + order tracking.
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN shipstation_carrier TEXT DEFAULT 'fedex'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN shipstation_service TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN label_weight_lbs NUMERIC DEFAULT 1; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN tracking_number TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN carrier TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
