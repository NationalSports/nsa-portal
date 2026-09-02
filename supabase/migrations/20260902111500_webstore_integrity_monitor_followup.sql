-- Follow-up hardening for the integrity monitor itself. This remains separate
-- from 20260902110000 because that migration reached production before these
-- two review improvements: self-RPC checks and reopened-alert generations.

create or replace function public.scan_webstore_integrity_monitor_rpcs()
returns table (
  incident_key text,
  category text,
  severity text,
  summary text,
  record_type text,
  record_id text,
  details jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    'security:rpc:' || f.label,
    'service_rpc_client_access', 'critical',
    'A service-only webstore monitor RPC regained direct client execution.',
    'database_function', f.label,
    '{}'::jsonb
  from (values
    ('scan_webstore_integrity', to_regprocedure('public.scan_webstore_integrity()')),
    ('sync_webstore_integrity_incidents', to_regprocedure('public.sync_webstore_integrity_incidents()')),
    ('claim_webstore_integrity_alert', to_regprocedure('public.claim_webstore_integrity_alert()')),
    ('complete_webstore_integrity_alert', to_regprocedure('public.complete_webstore_integrity_alert(uuid,text)')),
    ('fail_webstore_integrity_alert', to_regprocedure('public.fail_webstore_integrity_alert(uuid,text)'))
  ) f(label, proc)
  where f.proc is null
     or has_function_privilege('anon', f.proc, 'EXECUTE')
     or has_function_privilege('authenticated', f.proc, 'EXECUTE');
$$;

revoke all on function public.scan_webstore_integrity_monitor_rpcs()
  from public, anon, authenticated;
grant execute on function public.scan_webstore_integrity_monitor_rpcs()
  to service_role;

create or replace function public.sync_webstore_integrity_incidents()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_findings jsonb;
  v_finding_count integer;
  v_open_count integer;
  v_resolved_count integer;
  v_alert_keys text[];
  v_alert_version timestamptz;
  v_alert_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.severity desc, f.category, f.incident_key), '[]'::jsonb)
    into v_findings
  from (
    select distinct on (all_findings.incident_key) all_findings.*
    from (
      select * from public.scan_webstore_integrity()
      union all
      select * from public.scan_webstore_integrity_monitor_rpcs()
    ) all_findings
    order by all_findings.incident_key, all_findings.severity desc
  ) f;
  v_finding_count := jsonb_array_length(v_findings);

  insert into public.webstore_integrity_incidents as existing (
    incident_key, category, severity, summary, record_type, record_id, details
  )
  select f.incident_key, f.category, f.severity, f.summary, f.record_type, f.record_id,
         coalesce(f.details, '{}'::jsonb)
  from jsonb_to_recordset(v_findings) as f(
    incident_key text, category text, severity text, summary text,
    record_type text, record_id text, details jsonb
  )
  on conflict (incident_key) do update
    set category = excluded.category,
        severity = excluded.severity,
        summary = excluded.summary,
        record_type = excluded.record_type,
        record_id = excluded.record_id,
        details = excluded.details,
        last_seen_at = now(),
        last_alerted_at = case
          when existing.resolved_at is not null then null
          else existing.last_alerted_at end,
        resolved_at = null,
        occurrence_count = case
          when existing.resolved_at is not null then 1
          else existing.occurrence_count + 1 end,
        updated_at = now();

  with resolved as (
    update public.webstore_integrity_incidents i
       set resolved_at = now(), updated_at = now()
     where i.resolved_at is null
       and not exists (
         select 1
         from jsonb_to_recordset(v_findings) as f(incident_key text)
         where f.incident_key = i.incident_key
       )
     returning 1
  ) select count(*)::integer into v_resolved_count from resolved;

  select array_agg(i.incident_key order by i.severity desc, i.category, i.incident_key),
         max(i.last_seen_at)
    into v_alert_keys, v_alert_version
  from public.webstore_integrity_incidents i
  where i.resolved_at is null
    and (i.last_alerted_at is null or i.last_alerted_at < now() - interval '24 hours')
    and not exists (
      select 1 from public.webstore_integrity_alert_outbox a
      where a.status in ('pending', 'processing') and i.incident_key = any(a.incident_keys)
    );

  if cardinality(v_alert_keys) > 0 then
    insert into public.webstore_integrity_alert_outbox (dedupe_key, incident_keys)
    values (
      md5(array_to_string(v_alert_keys, ',') || ':' || coalesce(v_alert_version::text, '')),
      v_alert_keys
    )
    on conflict (dedupe_key) do nothing
    returning id into v_alert_id;
  end if;

  select count(*)::integer into v_open_count
  from public.webstore_integrity_incidents where resolved_at is null;

  insert into public.webstore_integrity_monitor_state (
    singleton, last_scan_at, finding_count, open_incident_count, updated_at
  ) values (true, now(), v_finding_count, v_open_count, now())
  on conflict (singleton) do update
    set last_scan_at = excluded.last_scan_at,
        finding_count = excluded.finding_count,
        open_incident_count = excluded.open_incident_count,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'scanned_at', now(),
    'finding_count', v_finding_count,
    'open_incident_count', v_open_count,
    'resolved_count', coalesce(v_resolved_count, 0),
    'alert_created', v_alert_id is not null,
    'findings', v_findings
  );
end;
$$;

revoke all on function public.sync_webstore_integrity_incidents()
  from public, anon, authenticated;
grant execute on function public.sync_webstore_integrity_incidents()
  to service_role;

comment on function public.scan_webstore_integrity_monitor_rpcs() is
  'Self-canary for the service-only integrity monitor RPC boundary.';
