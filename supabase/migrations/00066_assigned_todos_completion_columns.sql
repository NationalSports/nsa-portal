-- ============================================================
-- NSA Portal – Add missing completion columns to assigned_todos
-- Migration: 00066_assigned_todos_completion_columns
--
-- Migration 00019 declared completed_at / completed_by /
-- completion_note when it CREATE TABLE IF NOT EXISTS'd assigned_todos,
-- but if the table already existed at that point the IF NOT EXISTS
-- guard skipped the body and the columns were never added. PostgREST
-- then 400s on every _todoComplete update with:
--   "Could not find the 'completed_at' column of 'assigned_todos'
--    in the schema cache"
-- which silently breaks the ✓ (complete) button on assigned tasks.
-- ============================================================

ALTER TABLE public.assigned_todos
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by TEXT REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS completion_note TEXT;

NOTIFY pgrst, 'reload schema';
