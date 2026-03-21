-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 005: Customer Credits System
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ═══ CUSTOMER CREDITS (each credit entry on the account) ═══
-- Multiple credits can exist per customer. Each has a source description and running balance.
CREATE TABLE IF NOT EXISTS customer_credits (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,           -- original credit amount
  used NUMERIC NOT NULL DEFAULT 0,             -- amount consumed so far
  source TEXT,                                 -- description of where credit came from
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credits_customer ON customer_credits(customer_id);

-- ═══ CREDIT USAGE (tracks which orders consumed credit dollars) ═══
CREATE TABLE IF NOT EXISTS customer_credit_usage (
  id SERIAL PRIMARY KEY,
  credit_id TEXT NOT NULL REFERENCES customer_credits(id) ON DELETE CASCADE,
  so_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_usage_credit ON customer_credit_usage(credit_id);
CREATE INDEX IF NOT EXISTS idx_credit_usage_so ON customer_credit_usage(so_id);

-- ═══ ADD CREDIT FIELDS TO ESTIMATES & SALES ORDERS ═══
DO $$ BEGIN
  ALTER TABLE estimates ADD COLUMN credit_applied BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE estimates ADD COLUMN credit_amount NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN credit_applied BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN credit_amount NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══ RLS POLICIES ═══
ALTER TABLE customer_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_credit_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_credits FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_credit_usage FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
