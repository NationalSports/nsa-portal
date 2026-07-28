-- Migration 00236: auto-generate DTF requests from order art (art-sync lane).
--
-- Owner ask: DTF requests shouldn't need re-keying when the artwork already
-- lives on the order. When a DTF/heat-press job's art_status reaches
-- 'order_dtf_transfers' (approved, films need ordering — today a manual rep
-- todo), the dtf-orders sweep auto-creates a dtf_requests row from the job:
-- the .ai in the job's art files, qty = the job's units, and the print size
-- parsed from so_art_files.art_size (a single recorded number is treated as
-- the WIDTH; height derives from the artwork's aspect ratio).
--
-- source: 'manual' (page submission) | 'art_sync' (auto from a job). The
-- partial unique index makes the sync idempotent per (so_id, job_id) — and
-- because a canceled row still occupies the slot, staff canceling an auto
-- request is a durable opt-out (the sync will not re-create it).
alter table public.dtf_requests add column if not exists source text not null default 'manual';
create unique index if not exists dtf_requests_art_sync_job_uniq
  on public.dtf_requests (so_id, job_id) where (source = 'art_sync');

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop index if exists dtf_requests_art_sync_job_uniq;
--   alter table public.dtf_requests drop column if exists source;
