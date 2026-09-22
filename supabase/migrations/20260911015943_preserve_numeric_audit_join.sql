-- Scan deletion evidence once instead of once per flagged order/job.
create or replace function portal_diagnostics.get_health_report() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if current_setting('role', true) is distinct from 'service_role'
     and not coalesce(public.is_team_member(), false) then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  return (
with
  deletion_events as materialized (
    select a.id, a.changed_at, a.changed_by,
      coalesce(a.old_data->>'so_id', a.old_data->>'sales_order_id', i.so_id) as so_id,
      a.old_data->>'art_file_id' as art_file_id
    from public.audit_log a
    left join public.so_items i on i.id = case when a.old_data->>'so_item_id' ~ '^[0-9]{1,18}$' then (a.old_data->>'so_item_id')::bigint end
    where a.table_name = 'so_item_decorations' and a.op = 'DELETE'
  ),
  orphans_raw as (
    select
      j.id          as job_id,
      j.so_id,
      j.art_file_id,
      j.art_name,
      s.memo,
      s.status      as so_status
    from so_jobs j
    join sales_orders s on s.id = j.so_id and s.deleted_at is null
    where j.art_file_id is not null
      and j.art_file_id <> '__tbd'
      and not exists (
        select 1
        from so_item_decorations d
        join so_items i on i.id = d.so_item_id
        where i.so_id = j.so_id
          and d.art_file_id = j.art_file_id
      )
  ),
  orphans_active as (
    select o.* from orphans_raw o
    where not exists (
      select 1 from health_dismissals hd
      where hd.kind  = 'orphan'
        and hd.so_id = o.so_id
        and hd.job_id is not distinct from o.job_id
    )
  ),
  orphans as (
    select
      o.job_id,
      o.so_id,
      o.art_name,
      o.memo,
      o.so_status,
      d.changed_at                   as deco_deleted_at,
      d.changed_by                   as deco_deleted_by,
      coalesce(p.full_name, p.email) as deleted_by_name,
      case
        when d.id is null         then 'no_audit'
        when d.changed_by is null then 'system_loss'
        else                           'user_removed'
      end as verdict
    from orphans_active o
    left join (
      select distinct on (so_id, art_file_id) id, changed_at, changed_by, so_id, art_file_id
      from deletion_events order by so_id, art_file_id, changed_at desc, id desc
    ) d on d.so_id = o.so_id and d.art_file_id = o.art_file_id
    left join public.user_profiles p on p.auth_id = d.changed_by
  ),
  so_item_stats as (
    select
      s.id          as so_id,
      s.memo,
      s.status,
      s.updated_at,
      count(i.id)   as total_items,
      count(i.id) filter (
        where coalesce(i.no_deco, false) = false
          and not exists (select 1 from so_item_decorations d2 where d2.so_item_id = i.id)
      ) as missing_items
    from sales_orders s
    join so_items i on i.so_id = s.id
    where s.deleted_at is null
      and s.status in ('need_order','waiting_receive','needs_pull','items_received','in_production','ready_to_invoice')
      and (s.updated_at is null or s.updated_at::timestamptz < now() - interval '1 hour')
    group by s.id, s.memo, s.status, s.updated_at
  ),
  missing_deco_raw as (
    select so_id, memo, status, total_items, missing_items
    from so_item_stats
    where total_items > 0
      and missing_items::numeric / total_items > 0.5
  ),
  missing_deco_active as (
    select m.* from missing_deco_raw m
    where not exists (
      select 1 from health_dismissals hd
      where hd.kind = 'missing_deco' and hd.so_id = m.so_id
    )
  ),
  missing_deco as (
    select
      m.so_id, m.memo, m.status, m.total_items, m.missing_items,
      d.changed_at                   as deco_deleted_at,
      d.changed_by                   as deco_deleted_by,
      coalesce(p.full_name, p.email) as deleted_by_name,
      case
        when d.id is null         then 'no_audit'
        when d.changed_by is null then 'system_loss'
        else                           'user_removed'
      end as verdict
    from missing_deco_active m
    left join (
      select distinct on (so_id) id, changed_at, changed_by, so_id
      from deletion_events where changed_at >= now() - interval '30 days'
      order by so_id, changed_at desc, id desc
    ) d on d.so_id = m.so_id
    left join public.user_profiles p on p.auth_id = d.changed_by
  ),
  lost_24h as (
    select
      count(*) filter (where a.changed_by is null)     as system_count,
      count(*) filter (where a.changed_by is not null) as user_count
    from public.audit_log a
    where a.changed_at >= now() - interval '24 hours'
      and a.op = 'DELETE'
      and (
        (a.table_name = 'so_item_decorations' and a.old_data->>'kind' = 'art')
        or a.table_name = 'so_jobs'
      )
  )
  select jsonb_build_object(
    'generated_at',                    now(),
    'orphan_jobs',                     coalesce((select jsonb_agg(to_jsonb(o)) from orphans o), '[]'::jsonb),
    'missing_deco_sos',                coalesce((select jsonb_agg(to_jsonb(m)) from missing_deco m), '[]'::jsonb),
    'orphan_count',                    (select count(*) from orphans),
    'orphan_system_loss_count',        (select count(*) from orphans where verdict = 'system_loss'),
    'orphan_user_removed_count',       (select count(*) from orphans where verdict = 'user_removed'),
    'orphan_no_audit_count',           (select count(*) from orphans where verdict = 'no_audit'),
    'missing_deco_count',              (select count(*) from missing_deco),
    'missing_deco_system_loss_count',  (select count(*) from missing_deco where verdict = 'system_loss'),
    'lost_art_jobs_24h_system',        coalesce((select system_count from lost_24h), 0),
    'lost_art_jobs_24h_user',          coalesce((select user_count   from lost_24h), 0)
  )
  );
end;
$$;
