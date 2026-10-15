-- 1) The hourly QBO sync calls qbo_sales_source_snapshot through PostgREST as
--    service_role, which inherited authenticator's 8s statement_timeout. The
--    snapshot now takes 6-20s depending on load, so most runs since 2026-10-14
--    17:17 UTC failed with source_snapshot_failed. Server-side jobs get 60s;
--    user-facing roles (anon/authenticated) keep their 8s limit.
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';

-- 2) Watchdog for the daily QuickBooks + Stripe reconciliation email. That email
--    is sent by a scheduled Claude routine, which records a heartbeat in
--    app_state('daily_recon_heartbeat') after sending. If no heartbeat in 20h at
--    11:30 UTC (4:30 AM PDT / 3:30 AM PST), email Steve and Andrea through the
--    portal's own scheduled_emails sender, which does not depend on Claude.
create or replace function public.daily_recon_watchdog()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_last timestamptz;
begin
  select updated_at into v_last from public.app_state where id = 'daily_recon_heartbeat';
  if v_last is null or v_last < now() - interval '20 hours' then
    insert into public.scheduled_emails (
      send_at, to_emails, subject, html_content,
      sender_name, sender_email, related_type, related_id, created_by
    ) values (
      now(),
      jsonb_build_array(
        jsonb_build_object('email','steve@nationalsportsapparel.com','name','Steve Peterson'),
        jsonb_build_object('email','andrea@nationalsportsapparel.com','name','Andrea Jung')),
      '[Action required] Daily QuickBooks & Stripe check did not run',
      '<h2>The daily QuickBooks &amp; Stripe check did not run</h2>' ||
      '<p>Last successful check: ' || coalesce(to_char(v_last at time zone 'America/Los_Angeles','Mon DD, HH12:MI AM') || ' Pacific', 'never') || '.</p>' ||
      '<p>The hourly QuickBooks sync is not affected by this, but nobody reviewed it this morning. ' ||
      'Open the Claude conversation that runs the daily check and ask it to run the check now.</p>' ||
      '<p><a href="https://connect.nationalsportsapparel.com/?pg=qb">Open QuickBooks Sync</a></p>',
      'NSA QBO Monitor','noreply@nationalsportsapparel.com',
      'daily_recon_watchdog', to_char(now() at time zone 'America/Los_Angeles','YYYY-MM-DD'), 'qbo_sales_monitor'
    );
  end if;
end;
$function$;

revoke all on function public.daily_recon_watchdog() from public, anon, authenticated;

select cron.schedule('daily-recon-watchdog', '30 11 * * *', $cron$select public.daily_recon_watchdog()$cron$);
