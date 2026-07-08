-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 073: Pending Shipping Charges
-- Run this in Supabase SQL Editor.
--
-- Lets the warehouse record a billable shipping charge against a customer
-- who has NO open sales order (via Manual Ship → "Ship without an order").
-- The charge is stored per-customer and auto-attaches to the customer's
-- NEXT rep-created sales order (New SO / estimate→SO), mirroring the
-- existing customer_credits system in reverse (adds to the order instead
-- of subtracting).
-- Additive / idempotent — safe to run on a live database.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ PENDING SHIPPING CHARGES (one row per recorded manual ship) ═══
CREATE TABLE IF NOT EXISTS customer_pending_shipping (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,        -- billable shipping charge to carry to the next order
  used NUMERIC NOT NULL DEFAULT 0,          -- amount applied to orders so far
  cost NUMERIC DEFAULT 0,                   -- internal label cost paid (carried onto the SO for margin)
  source TEXT,                              -- description / reason (e.g. "Manual ship 7/3 · 1Z…")
  tracking_number TEXT,
  carrier TEXT,
  label_url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_ship_customer ON customer_pending_shipping(customer_id);

-- ═══ USAGE (tracks which orders consumed a pending shipping charge) ═══
CREATE TABLE IF NOT EXISTS customer_pending_shipping_usage (
  id SERIAL PRIMARY KEY,
  pending_id TEXT NOT NULL REFERENCES customer_pending_shipping(id) ON DELETE CASCADE,
  so_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pending_ship_usage_pending ON customer_pending_shipping_usage(pending_id);
CREATE INDEX IF NOT EXISTS idx_pending_ship_usage_so ON customer_pending_shipping_usage(so_id);

-- ═══ SALES ORDER COLUMNS (mirror of credit_applied / credit_amount) ═══
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pending_ship_applied BOOLEAN DEFAULT false;
ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS pending_ship_amount NUMERIC DEFAULT 0;

-- ═══ RLS POLICIES ═══
ALTER TABLE customer_pending_shipping ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_pending_shipping_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_pending_shipping FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_pending_shipping_usage FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
