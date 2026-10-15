-- Individual QBO alert emails are replaced by one daily reconciliation digest.
-- Manual reviews are still recorded in qbo_sales_manual_reviews; they just no
-- longer send one email each. Re-enable with:
--   alter table public.qbo_sales_manual_reviews enable trigger qbo_sales_manual_review_email;
alter table public.qbo_sales_manual_reviews disable trigger qbo_sales_manual_review_email;

-- A sync outage should not wait for the digest, but one outage used to send an
-- email per failed hourly run (12 on 2026-10-14). Email only the first failure of
-- a streak: when the previous finished run did not fail.
create or replace function public.queue_qbo_sales_run_failure_email()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.status = 'failed' and old.status is distinct from new.status
     and coalesce((
       select r.status from public.qbo_sales_runs r
       where r.id <> new.id and r.company_key = new.company_key and r.started_at < new.started_at
         and r.status <> 'running'
       order by r.started_at desc limit 1
     ), '') <> 'failed' then
    insert into public.scheduled_emails (
      send_at, to_emails, subject, html_content,
      sender_name, sender_email, related_type, related_id, created_by
    ) values (
      now(),
      jsonb_build_array(jsonb_build_object('email','steve@nationalsportsapparel.com','name','Steve Peterson')),
      '[Action required] QBO hourly import failed — ' || coalesce(new.error_code, 'unknown error'),
      '<h2>QuickBooks hourly import failed</h2>' ||
      '<p><strong>Run:</strong> ' || new.id::text || '</p>' ||
      '<p><strong>Started:</strong> ' || new.started_at::text || '</p>' ||
      '<p><strong>Error code:</strong> ' || coalesce(new.error_code, 'unknown') || '</p>' ||
      '<p>The failed run stopped safely. Further failures in a row are not emailed again; the daily reconciliation email reports them.</p>' ||
      '<p><a href="https://connect.nationalsportsapparel.com/?pg=qb">Open QuickBooks Sync</a></p>',
      'NSA QBO Monitor','noreply@nationalsportsapparel.com',
      'qbo_sales_run_failure',new.id::text,'qbo_sales_monitor'
    )
    on conflict (related_type, related_id)
      where related_type in ('qbo_sales_run_failure','qbo_sales_manual_review')
    do nothing;
  end if;
  return new;
end;
$function$;
