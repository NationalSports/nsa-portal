-- A reused design needs a decision on each new job before it can be sent to a coach.
-- The original bootstrap check predates the art_requested/in_progress statuses that
-- production already uses; the live table no longer has that check.
alter table public.so_jobs drop constraint if exists so_jobs_art_status_check;

alter table public.so_jobs
  add column if not exists art_reuse_confirmed boolean not null default false;

alter table public.so_art_files
  add column if not exists reused_from_so text;

alter table public.estimate_art_files
  add column if not exists reused_from_so text;
