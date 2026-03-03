-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 003: Promo Dollars System
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ═══ PROMO PROGRAMS (defines promo programs per customer) ═══
-- A customer can have multiple programs (e.g., fixed + percent_of_spend)
CREATE TABLE IF NOT EXISTS customer_promo_programs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('fixed', 'percent_of_spend')),
  fixed_amount NUMERIC DEFAULT 0,        -- $ amount per period (for 'fixed' type)
  spend_percentage NUMERIC DEFAULT 0,    -- e.g., 0.10 for 10% (for 'percent_of_spend' type)
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_programs_customer ON customer_promo_programs(customer_id);

-- ═══ PROMO PERIODS (each 6-month period's balance) ═══
-- Periods: H1 = Jan 1 – Jun 30, H2 = Jul 1 – Dec 31
CREATE TABLE IF NOT EXISTS customer_promo_periods (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  program_id TEXT REFERENCES customer_promo_programs(id) ON DELETE SET NULL,
  period_start TEXT NOT NULL,            -- '2026-01-01'
  period_end TEXT NOT NULL,              -- '2026-06-30'
  allocated NUMERIC NOT NULL DEFAULT 0,  -- total promo $ for this period
  used NUMERIC NOT NULL DEFAULT 0,       -- amount consumed so far
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_periods_customer ON customer_promo_periods(customer_id);

-- ═══ PROMO USAGE (tracks which orders consumed promo dollars) ═══
CREATE TABLE IF NOT EXISTS customer_promo_usage (
  id SERIAL PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES customer_promo_periods(id) ON DELETE CASCADE,
  so_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  description TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_promo_usage_period ON customer_promo_usage(period_id);
CREATE INDEX IF NOT EXISTS idx_promo_usage_so ON customer_promo_usage(so_id);

-- ═══ ADD PROMO FIELDS TO ESTIMATES & SALES ORDERS ═══
DO $$ BEGIN
  ALTER TABLE estimates ADD COLUMN promo_applied BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE estimates ADD COLUMN promo_amount NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN promo_applied BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN promo_amount NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══ ADD PROMO FLAG TO LINE ITEMS ═══
DO $$ BEGIN
  ALTER TABLE estimate_items ADD COLUMN is_promo BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE so_items ADD COLUMN is_promo BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ═══ RLS POLICIES ═══
ALTER TABLE customer_promo_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_promo_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_promo_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_promo_programs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_promo_periods FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_promo_usage FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
