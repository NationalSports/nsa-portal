-- Migration 027: guard against duplicate order-confirmation emails. Whichever
-- of the client or the Stripe webhook sends first atomically claims this flag.
DO $$ BEGIN ALTER TABLE webstore_orders ADD COLUMN confirmation_sent BOOLEAN DEFAULT false; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
