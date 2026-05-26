-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 014: Store-level delivery mode (rep-chosen)
-- PURELY ADDITIVE — one ADD COLUMN with default.
-- ═══════════════════════════════════════════════════════════════════
DO $$ BEGIN ALTER TABLE webstores ADD COLUMN delivery_mode TEXT DEFAULT 'ship_home'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
UPDATE webstores SET delivery_mode = COALESCE(delivery_mode, 'ship_home') WHERE delivery_mode IS NULL;
