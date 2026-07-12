-- Migration 00210: so_jobs.notes — a free-text production note per job.
--
-- The shop-floor iPad sheet (job-scan.js event:'resolve' → FloorStation JobPanel)
-- shows art/SO/job/deco/positions/units and DST links, but had no place for a
-- per-job production note (special handling, placement caveats, rush reason) and
-- no size breakdown. so_jobs carried no notes column at all — this adds it.
--
-- The size breakdown needs NO schema: so_jobs.items already carries each covered
-- item's sizes (jsonb, the same shape auto-release/isJobReady read); job-scan
-- derives the breakdown from it. This migration adds only the notes column.
--
-- Additive, nullable — untouched rows are unaffected and every existing so_jobs
-- reader keeps working. so_jobs already has staff-only RLS (00192 and prior); a
-- new nullable column needs no policy change (the table's row policies cover all
-- columns). The Production Job Sheet already references j.notes (App.js), so once
-- this lands those notes render on the printed sheet too.

alter table public.so_jobs add column if not exists notes text;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   alter table public.so_jobs drop column if exists notes;
