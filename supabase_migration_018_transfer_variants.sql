-- Migration 018: transfers vary by size (8in/4in) and color; a number transfer
-- is a (digit,size,color) SKU. Items say which number set their numbers use.
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN tsize TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN color TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN digit TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN num_transfer_size TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_products ADD COLUMN num_transfer_color TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_bundle_items ADD COLUMN num_transfer_size TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_bundle_items ADD COLUMN num_transfer_color TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
