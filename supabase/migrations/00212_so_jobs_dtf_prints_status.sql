-- Migration 00212: DTF prints readiness signal + received bin.
--
-- A DTF job isn't releasable until its transfer prints are physically in hand,
-- even when the garments are. so_jobs.dtf_prints_status is the denormalized
-- per-job signal the auto-release sweep reads (teamshop-auto-release.js) to hold a
-- DTF job until its prints land — WITHOUT touching 00205's SQL release gate (which
-- stays garments+art only; the sweep is where fulfillment truth is computed, per
-- 00205's own header). Lifecycle, written by netlify/functions/teamshop-auto-po.js:
--   * 'needed'   — a DTF print need was recorded for the job (recordDtfNeeds);
--   * 'ordered'  — the job's prints were batched into a draft PO (sweepDtf);
--   * 'received' — the prints were received into a bin (receiveDtf).
--   * null       — no DTF need (not a DTF job, or none recorded) → never blocks.
--
-- teamshop_dtf_print_needs.bin records WHERE the received prints were put away
-- (boxes.bin holds the physical box's location; this denormalizes it per-job so the
-- iPad floor sheet and Production HQ can show a job's bin without a boxes join).
-- Both are additive/nullable — every existing reader is unaffected. so_jobs and
-- teamshop_dtf_print_needs already have staff-only RLS; new nullable columns need
-- no policy change.

alter table public.so_jobs add column if not exists dtf_prints_status text
  check (dtf_prints_status is null or dtf_prints_status in ('needed', 'ordered', 'received'));

alter table public.teamshop_dtf_print_needs add column if not exists bin text;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   alter table public.so_jobs drop column if exists dtf_prints_status;
--   alter table public.teamshop_dtf_print_needs drop column if exists bin;
