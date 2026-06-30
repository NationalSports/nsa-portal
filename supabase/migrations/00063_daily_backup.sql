-- Daily automatic full-database backup.
--
-- Creates a private 'backups' storage bucket and schedules the daily-backup
-- Edge Function to run every day at 07:00 UTC (≈ 2-3am US Eastern).
-- The function snapshots every app table to backups/backup-YYYY-MM-DD.json.gz
-- and prunes any file older than 30 days.

-- ─── Private storage bucket ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'backups',
  'backups',
  false,
  524288000, -- 500 MB ceiling per snapshot
  ARRAY['application/json','application/gzip','application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- No storage.objects policies: only the service role (which bypasses RLS)
-- can read or write this bucket. Authenticated users have no access.

-- ─── Daily cron schedule ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any previous schedule with this name so re-running is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-backup');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-backup',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
