-- One-off cleanup: remove SO-1002's orphan jobs.
--
-- These two jobs reference items/decorations that were wiped by the
-- so_items-timeout data-loss bug fixed in PR #725. The audit log added in
-- PR #726 will catch any future incidents. The customer (per #issue) is
-- re-entering the items, so the existing jobs need to go.

DELETE FROM public.so_jobs
WHERE so_id = 'SO-1002'
  AND id IN ('JOB-1002-01', 'JOB-1002-02');
