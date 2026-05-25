-- Migration 021/022: route webstore ship-to-home orders into a dedicated
-- ShipStation Store and optionally apply a per-team tag.
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN shipstation_store_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN shipstation_tag_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
