-- Intraday backups: run the daily-backup edge function every 3 hours (offset from the 07:00 daily run)
-- with {intraday:true}, so it writes timestamped backup-YYYY-MM-DDTHHMM.json.gz files instead of
-- overwriting the daily snapshot. Shrinks the recovery window from ~24h to ~3h.
--
-- The daily-backup function (v4+) also now skips tables that don't exist instead of aborting the whole
-- snapshot — the nightly backup had been failing on missing tables (app_settings, etc.).
select cron.schedule('intraday-backup', '0 2,5,8,11,14,17,20,23 * * *', $cron$
  SELECT net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/daily-backup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"intraday": true}'::jsonb,
    timeout_milliseconds := 120000
  );
$cron$);
