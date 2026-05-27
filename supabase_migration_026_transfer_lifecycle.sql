-- Migration 026: heat-transfer inventory lifecycle.
-- On hand (physical) → On order (placed, not pulled) → In process (pulled,
-- decorating) → done (shipped). Incoming = ordered from supplier w/ ETA.
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN incoming NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_transfers ADD COLUMN incoming_eta DATE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
UPDATE webstore_transfers SET incoming = on_order WHERE COALESCE(on_order,0) > 0 AND COALESCE(incoming,0) = 0;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN transfers_pulled BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN transfers_pulled_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
