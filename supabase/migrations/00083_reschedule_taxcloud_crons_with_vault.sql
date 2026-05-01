-- Reschedule the two taxcloud-refresh cron jobs using the Vault pattern.
--
-- The original schedules in 00011_taxcloud_quarterly_cron.sql and
-- 00066_taxcloud_daily_missing_rates_cron.sql used
--   current_setting('app.settings.service_role_key')
-- which silently fails on Supabase managed Postgres (custom GUCs cannot
-- be set). Both cron entries never actually appeared in cron.job, and as
-- a result the daily-missing-rates job has never run. Audit on 2026-05-01
-- found 993 customers with NULL tax rates accumulated since launch.
--
-- This migration follows the same pattern used by:
--   00079_reschedule_send_emails_cron_with_vault.sql
--   00082_schedule_daily_backup_cron.sql
--
-- Pre-requisites (already in place on prod):
--   - pg_net extension (00078)
--   - vault.secrets entry named 'service_role_key' (added via dashboard)
--   - taxcloud-refresh edge function (deployed long ago, verify_jwt=true)
--
-- Manual test against prod (2026-05-01) returned HTTP 200 and successfully
-- backfilled a customer rate, confirming the function works under this
-- exact http_post payload — only the scheduling was broken.
--
-- Rollback (run via SQL editor if needed):
--   SELECT cron.unschedule('taxcloud-quarterly-refresh');
--   SELECT cron.unschedule('taxcloud-daily-missing-rates');

-- ─── Quarterly full refresh ─────────────────────────────────────────────
-- Runs at 06:00 UTC on the 1st of Jan/Apr/Jul/Oct, refreshes ALL active
-- customers' rates so jurisdictional changes get picked up.
DO $$ BEGIN
  PERFORM cron.unschedule('taxcloud-quarterly-refresh');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'taxcloud-quarterly-refresh',
  '0 6 1 1,4,7,10 *',
  $cmd$
  SELECT net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/taxcloud-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 600000
  );
  $cmd$
);

-- ─── Daily backfill of missing rates ────────────────────────────────────
-- Runs at 07:00 UTC daily (= midnight Pacific Standard Time). Only touches
-- customers whose tax_rate IS NULL, capped at 100 per run, so it gradually
-- drains the backlog without overwhelming TaxCloud.
DO $$ BEGIN
  PERFORM cron.unschedule('taxcloud-daily-missing-rates');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'taxcloud-daily-missing-rates',
  '0 7 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/taxcloud-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('only_missing', true, 'limit', 100),
    timeout_milliseconds := 120000
  );
  $cmd$
);
