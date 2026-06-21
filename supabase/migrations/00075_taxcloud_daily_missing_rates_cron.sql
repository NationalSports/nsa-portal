-- Daily catch-up cron for tax rate lookups.
-- Calls taxcloud-refresh with default body { only_missing: true, limit: 100 } so
-- new customers added since the last run get a rate within ~24 hours, without
-- touching customers that already have one.
--
-- The legacy quarterly cron (00011) still runs to refresh ALL rates for
-- jurisdictional changes; this daily one only fills in gaps.
--
-- pg_cron is already enabled by 00011_taxcloud_quarterly_cron.sql.

-- Unschedule any prior job with the same name so this migration is rerunnable.
DO $$
BEGIN
  PERFORM cron.unschedule('taxcloud-daily-missing-rates');
EXCEPTION WHEN OTHERS THEN
  -- ignore if it didn't exist
  NULL;
END $$;

SELECT cron.schedule(
  'taxcloud-daily-missing-rates',
  '0 7 * * *',  -- 7 AM UTC daily (= midnight Pacific Standard Time)
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/taxcloud-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('only_missing', true, 'limit', 100)
  );
  $$
);
