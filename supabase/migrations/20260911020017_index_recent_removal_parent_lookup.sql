create or replace function portal_diagnostics.recent_lost_art_and_jobs(p_since timestamptz default (now() - interval '7 days'))
returns table (
  event_kind     text,        -- 'art' | 'job'
  so_id          text,
  item_id        text,
  art_file_id    text,
  art_name       text,
  "position"     text,
  removed_at     timestamptz,
  removed_by_uid uuid,
  removed_by     text,        -- full_name, or email, or null if system/unknown
  detail         text         -- short human-readable summary
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and not coalesce(public.is_team_member(), false) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return query
  -- Art decoration deletions
  select
    'art'::text                             as event_kind,
    coalesce(a.old_data->>'so_id', a.old_data->>'sales_order_id', (select i.so_id from public.so_items i where i.id = case when a.old_data->>'so_item_id' ~ '^[0-9]{1,18}$' then (a.old_data->>'so_item_id')::bigint end))           as so_id,
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
    coalesce(a.old_data->>'so_id', a.old_data->>'sales_order_id', (select i.so_id from public.so_items i where i.id = case when a.old_data->>'so_item_id' ~ '^[0-9]{1,18}$' then (a.old_data->>'so_item_id')::bigint end))           as so_id,
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

  order by 7 desc;
end;
$$;
