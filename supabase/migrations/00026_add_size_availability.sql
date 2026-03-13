-- Add size_availability JSONB column to track per-size availability dates
-- Format: {"M": "2026-03-20", "L": "2026-04-01"} — only sizes with delayed dates

ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS size_availability JSONB DEFAULT '{}';
ALTER TABLE so_items ADD COLUMN IF NOT EXISTS size_availability JSONB DEFAULT '{}';
