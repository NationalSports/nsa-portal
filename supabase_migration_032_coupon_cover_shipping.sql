-- Migration 032: per-coupon toggle for whether a percent code also discounts shipping.
DO $$ BEGIN ALTER TABLE webstore_coupons ADD COLUMN cover_shipping BOOLEAN DEFAULT true; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
