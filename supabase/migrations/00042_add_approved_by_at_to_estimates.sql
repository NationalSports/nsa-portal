-- Add approved_by and approved_at columns to estimates.
-- These fields were added to _estCols in code (commit 2366784) but never
-- had a corresponding DB migration, causing coach approvals to be stripped
-- on every upsert retry and never persisted to the database.

ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS approved_at TEXT;
