-- Migration 029: track refunded amount on a webstore order.
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN refunded_amt NUMERIC DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
