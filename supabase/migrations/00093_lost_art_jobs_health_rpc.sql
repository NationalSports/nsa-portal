-- Health check: surface ART decorations and jobs that were recently removed
-- from sales orders, with attribution (who pulled the trigger).
--
-- The audit_log trigger (00064) already captures every DELETE on
-- so_item_decorations and so_jobs along with auth.uid(). This RPC filters
-- those down to the events that matter for "did we lose art?" — art-kind
-- decoration deletes and job deletes — and joins user_profiles so the UI
-- can show a name instead of a UUID.
--
-- security definer because audit_log RLS only lets a user read their own
-- entries; the System Health card needs to see deletes by anyone.

create or replace function public.recent_lost_art_and_jobs(
  p_since timestamptz default (now() - interval '7 days')
)
returns table (
  event_kind     text,        -- 'art' | 'job'
  so_id          text,
  item_id        text,
  art_file_id    text,
  art_name       text,
  position       text,
  removed_at     timestamptz,
  removed_by_uid uuid,
  removed_by     text,        -- full_name, or email, or null if system/unknown
  detail         text         -- short human-readable summary
)
language sql
stable
security definer
set search_path = public
as $$
  -- Art decoration deletions
  select
    'art'::text                             as event_kind,
    a.old_data->>'sales_order_id'           as so_id,
    a.old_data->>'so_item_id'               as item_id,
    a.old_data->>'art_file_id'              as art_file_id,
    coalesce(a.old_data->>'art_name','')    as art_name,
    coalesce(a.old_data->>'position','')    as position,
    a.changed_at                            as removed_at,
    a.changed_by                            as removed_by_uid,
    coalesce(p.full_name, p.email)          as removed_by,
    'Art removed: '
      || coalesce(nullif(a.old_data->>'art_name',''),
                  a.old_data->>'art_file_id',
                  'unnamed')
      || case when coalesce(a.old_data->>'position','')<>''
              then ' @ '||(a.old_data->>'position') else '' end
                                            as detail
  from public.audit_log a
  left join public.user_profiles p on p.auth_id = a.changed_by
  where a.table_name = 'so_item_decorations'
    and a.op = 'DELETE'
    and a.changed_at >= p_since
    and (a.old_data->>'kind') = 'art'

  union all

  -- Job deletions (any kind — losing a job is always notable)
  select
    'job'::text                             as event_kind,
    a.old_data->>'sales_order_id'           as so_id,
    null::text                              as item_id,
    a.old_data->>'art_file_id'              as art_file_id,
    coalesce(a.old_data->>'art_name','')    as art_name,
    coalesce(a.old_data->>'position','')    as position,
    a.changed_at                            as removed_at,
    a.changed_by                            as removed_by_uid,
    coalesce(p.full_name, p.email)          as removed_by,
    'Job removed: '
      || coalesce(nullif(a.old_data->>'art_name',''),
                  a.old_data->>'job_key',
                  a.old_data->>'id',
                  'job')
                                            as detail
  from public.audit_log a
  left join public.user_profiles p on p.auth_id = a.changed_by
  where a.table_name = 'so_jobs'
    and a.op = 'DELETE'
    and a.changed_at >= p_since

  order by removed_at desc
$$;

revoke execute on function public.recent_lost_art_and_jobs(timestamptz) from public;
grant  execute on function public.recent_lost_art_and_jobs(timestamptz) to authenticated, service_role;

comment on function public.recent_lost_art_and_jobs(timestamptz) is
  'System Health: returns recent DELETE events from so_item_decorations (kind=art) and so_jobs with user attribution. Backed by audit_log.';
