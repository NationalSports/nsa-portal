-- Time entries table for tracking art and production work time
-- Supports both art department and decoration/production time clocks

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  department TEXT NOT NULL CHECK (department IN ('art', 'production', 'decoration')),
  person_name TEXT NOT NULL,
  job_id TEXT,           -- job reference (e.g. JOB-1042-01)
  so_id TEXT,            -- sales order reference (e.g. SO-1042)
  art_name TEXT,         -- art file name (for art dept entries)
  customer_name TEXT,
  clock_in TIMESTAMPTZ NOT NULL,
  clock_out TIMESTAMPTZ,
  minutes INTEGER DEFAULT 0,
  hourly_rate NUMERIC(10,2) DEFAULT 0,
  labor_cost NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_time_entries_department ON time_entries(department);
CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(person_name);
CREATE INDEX IF NOT EXISTS idx_time_entries_so_id ON time_entries(so_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_clock_in ON time_entries(clock_in);

-- Labor rates table for per-person hourly rates
CREATE TABLE IF NOT EXISTS labor_rates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  person_name TEXT NOT NULL UNIQUE,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
  department TEXT,       -- art, production, decoration
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Enable RLS
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE labor_rates ENABLE ROW LEVEL SECURITY;

-- Policies: all authenticated users can read, admins can write
CREATE POLICY "time_entries_select" ON time_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "time_entries_insert" ON time_entries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "time_entries_update" ON time_entries FOR UPDATE TO authenticated USING (true);

CREATE POLICY "labor_rates_select" ON labor_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "labor_rates_insert" ON labor_rates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "labor_rates_update" ON labor_rates FOR UPDATE TO authenticated USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE time_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE labor_rates;
