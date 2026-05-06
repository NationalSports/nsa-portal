-- Creates the private `backups` storage bucket used by the daily-backup
-- edge function. No storage.objects policies are added — only the
-- service role (which bypasses RLS) reads or writes this bucket.
-- Authenticated and anon users have no access.
--
-- The original migration 00059_daily_backup.sql also created this bucket
-- but was never applied to prod (consistent with the migration drift
-- documented elsewhere in this audit). Recreating the bucket here so
-- the daily-backup edge function has somewhere to upload to.
--
-- Rollback (run via SQL editor if needed):
--   DELETE FROM storage.buckets WHERE id = 'backups';
--   (objects in the bucket must be removed first, or use cascading
--    delete in the dashboard)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'backups',
  'backups',
  false,
  524288000, -- 500 MB ceiling per snapshot
  ARRAY['application/json','application/gzip','application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;
