-- Enable pg_cron extension (Supabase has this available)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Quarterly tax rate refresh via TaxCloud
-- Runs at 6 AM UTC on Jan 1, Apr 1, Jul 1, Oct 1
-- Calls the taxcloud-refresh edge function which updates all active customer rates
SELECT cron.schedule(
  'taxcloud-quarterly-refresh',
  '0 6 1 1,4,7,10 *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/taxcloud-refresh',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
