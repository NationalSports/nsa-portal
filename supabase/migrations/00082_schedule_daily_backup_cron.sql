-- Schedules the daily-backup edge function to run nightly at 07:00 UTC
-- (~ 2-3 am US Eastern). Uses the Vault-aware command pattern from
-- 00079_reschedule_send_emails_cron_with_vault.sql; the original
-- migration 00059 used app.settings.* GUCs that can't be set on
-- Supabase managed Postgres.
--
-- Pre-requisites for this migration to actually fire:
--   - pg_net extension (installed by 00078)
--   - vault.secrets entry named 'service_role_key' (added via dashboard)
--   - 'backups' storage bucket (created by 00081)
--   - daily-backup edge function deployed (deployed via MCP separately)
--
-- Rollback (run via SQL editor if needed):
--   SELECT cron.unschedule('daily-backup');

DO $$ BEGIN
  PERFORM cron.unschedule('daily-backup');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'daily-backup',
  '0 7 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);
