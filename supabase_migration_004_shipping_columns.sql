-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 004: Shipping Columns
-- Run this in Supabase SQL Editor
-- Adds missing columns for shipment tracking and shipping costs
-- ═══════════════════════════════════════════════════════════════════

-- _shipments: JSONB array of shipment objects created from warehouse
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN _shipments JSONB DEFAULT '[]';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- _shipping_cost: accumulated shipping label costs
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN _shipping_cost NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ship_preference: ship_as_ready, wait_complete, rep_delivery, ship_on_date
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN ship_preference TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ship_on_date: target ship date when ship_preference = 'ship_on_date'
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN ship_on_date TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
