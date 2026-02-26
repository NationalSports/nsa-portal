-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 002: app_state table + po_lines fixes
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ═══ APP STATE (key-value store for batch POs, inventory POs, changelog, etc.) ═══
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON app_state FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enable realtime on app_state so changes sync across browser sessions
ALTER PUBLICATION supabase_realtime ADD TABLE app_state;
