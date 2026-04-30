-- Reschedules the send-scheduled-emails cron with a Vault-aware command.
--
-- Background: 00067_scheduled_emails.sql scheduled the cron with a body
-- that read app.settings.supabase_url and app.settings.service_role_key
-- via current_setting(). On Supabase managed Postgres those custom GUCs
-- can't be set (ALTER DATABASE / ALTER ROLE both reject). 00078 added
-- pg_net so the schema "net" error is resolved, but the cron still
-- needed real credentials.
--
-- Fix: hard-code the public REST URL (not secret) and read the service
-- role key from Supabase Vault, where it has been stored as the secret
-- named 'service_role_key'. Vault encrypts at rest with libsodium, so
-- the key is never exposed in cron.job.command (the command stores the
-- subquery, not the resolved value).
--
-- Operator action required before this migration takes effect:
--   The Vault secret named 'service_role_key' must exist with the
--   project's service_role key as its value. Add it via Supabase
--   Dashboard → Project Settings → Vault → Secrets → Add new secret.
--
-- Rollback (run via SQL editor if needed):
--   SELECT cron.unschedule('send-scheduled-emails');

DO $$ BEGIN
  PERFORM cron.unschedule('send-scheduled-emails');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'send-scheduled-emails',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/send-scheduled-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cmd$
);
