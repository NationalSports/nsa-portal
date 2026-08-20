-- so_jobs.completed_at — the missing completion stamp column.
--
-- The advance_job_stage RPC (00192) already stamps completed_at on the 'decorated'
-- event ("mirror applyJobMove's completion stamp"), but the column itself never
-- shipped — a scan-driven 'decorated' event throws 42703 (column does not exist),
-- and the Prod Board's in-memory completed_at stamp (applyJobMove) is silently
-- dropped on save because so_jobs has nowhere to hold it.
--
-- With the column in place, production surfaces can tell a JUST-finished job from
-- months-old history: invoicing an SO sets sticky status='complete' minutes after
-- the decorator's Done click (SO-1512, 2026-08-18: final invoice 5 minutes after
-- both jobs completed), and the boards used to treat that financial close as
-- "out the door" and yank the jobs off the Completed views before shipping ever
-- saw them.
alter table public.so_jobs add column if not exists completed_at timestamptz;

-- Backfill from the audit log: each job's latest transition INTO 'completed'.
-- Job ids embed their SO number (JOB-1512-01) so row_id alone identifies the job.
-- Only fills NULLs on already-finished jobs — never overwrites a live stamp.
update public.so_jobs j
set completed_at = t.completed_at
from (
  select row_id, max(changed_at) as completed_at
  from public.audit_log
  where table_name = 'so_jobs'
    and (new_data->>'prod_status') = 'completed'
    and (old_data->>'prod_status') is distinct from 'completed'
  group by row_id
) t
where j.id = t.row_id
  and j.completed_at is null
  and j.prod_status in ('completed','shipped');
