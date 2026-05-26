-- Migration 019: track transfers on order (incoming) separately from in-house.
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN on_order INT NOT NULL DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
