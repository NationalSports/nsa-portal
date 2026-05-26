-- Migration 024/025: capture actual label cost + per-store flat shipping charged
-- to buyers, so reports can show shipping net (flat collected - actual postage).
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN label_cost NUMERIC; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN flat_shipping NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN shipping_fee NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
