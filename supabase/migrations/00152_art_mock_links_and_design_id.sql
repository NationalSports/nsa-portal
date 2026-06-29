-- Artwork persistence + logo-based reuse foundation
-- Phase 0 (PG-2): persist garment mock_links — today they are stripped by the
--   _artCols allowlist and have no column, so garment links vanish on reload.
-- LOGO-1: add a stable design_id so reuse keys off identity, not the art name string.
-- Safe to run more than once (IF NOT EXISTS / idempotent backfill).

-- mock_links: { "sku|color": "sourceSku|sourceColor", ... }
ALTER TABLE so_art_files       ADD COLUMN IF NOT EXISTS mock_links jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE estimate_art_files ADD COLUMN IF NOT EXISTS mock_links jsonb NOT NULL DEFAULT '{}'::jsonb;

-- design_id: stable identity for a logo/design, shared across orders that reuse it.
ALTER TABLE so_art_files       ADD COLUMN IF NOT EXISTS design_id text;
ALTER TABLE estimate_art_files ADD COLUMN IF NOT EXISTS design_id text;

-- Backfill design_id from name+deco_type for existing rows so reuse matching works
-- immediately. New rows get a design_id stamped client-side at creation.
UPDATE so_art_files
   SET design_id = 'design_' || md5(lower(coalesce(name, '')) || '|' || coalesce(deco_type, ''))
 WHERE design_id IS NULL AND coalesce(name, '') <> '';

UPDATE estimate_art_files
   SET design_id = 'design_' || md5(lower(coalesce(name, '')) || '|' || coalesce(deco_type, ''))
 WHERE design_id IS NULL AND coalesce(name, '') <> '';

-- Helps the reuse lookup (priorMocks) that filters other orders' art by design_id.
CREATE INDEX IF NOT EXISTS idx_so_art_files_design_id ON so_art_files (design_id);
