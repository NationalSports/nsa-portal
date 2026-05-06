-- System Health upgrade
--
-- 1. New table public.health_dismissals — lets a user mark a flagged orphan
--    job or "missing most decorations" SO as "not a problem". Both the in-app
--    System Health card and the scheduled so-health-alert email read through
--    get_health_report(), so a single dismiss row hides the entry everywhere.
--
-- 2. Rebuild public.get_health_report() to
--      • exclude dismissed rows,
--      • cross-reference each remaining orphan / missing-deco SO against
--        audit_log so the report can distinguish:
--           system_loss   — a so_item_decorations DELETE with changed_by NULL
--                           (the smoking-gun signal: a delete with no
--                           authenticated user, i.e. a persistence regression)
--           user_removed  — a DELETE with a known auth.uid() — intentional but
--                           the linked job/items were not cleaned up
--           no_audit      — no matching DELETE event in retention window —
--                           usually means the SO never had decoration data
--                           (blanks SO, in-progress entry) — low signal
--      • surface a 24h "lost art / jobs" rollup so the email can lead with the
--        forensic count (system vs person) instead of just raw orphan totals.

-- ─── health_dismissals table ───────────────────────────────────────────────
create table if not exists public.health_dismissals (
  id            bigserial primary key,
  kind          text not null check (kind in ('orphan','missing_deco')),
  so_id         text not null,
  job_id        text,                          -- only set for kind='orphan'
  reason        text,
  dismissed_by  uuid,
  dismissed_at  timestamptz not null default now()
);

create unique index if not exists ux_health_dismissals_orphan
  on public.health_dismissals(kind, so_id, job_id)
  where kind = 'orphan';

create unique index if not exists ux_health_dismissals_missing
  on public.health_dismissals(kind, so_id)
  where kind = 'missing_deco';

alter table public.health_dismissals enable row level security;

drop policy if exists health_dismissals_service_all on public.health_dismissals;
create policy health_dismissals_service_all on public.health_dismissals
  for all to service_role using (true) with check (true);

drop policy if exists health_dismissals_auth_rw on public.health_dismissals;
create policy health_dismissals_auth_rw on public.health_dismissals
  for all to authenticated using (true) with check (true);

comment on table public.health_dismissals is
  'Per-row "not a problem" markers for the System Health report. get_health_report() excludes matching rows.';

-- ─── get_health_report() rebuild ───────────────────────────────────────────
create or replace function public.get_health_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
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
    left join lateral (
      select a.id, a.changed_at, a.changed_by
      from public.audit_log a
      where a.table_name = 'so_item_decorations'
        and a.op         = 'DELETE'
        and a.old_data->>'sales_order_id' = o.so_id
        and a.old_data->>'art_file_id'    = o.art_file_id
      order by a.changed_at desc
      limit 1
    ) d on true
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
      and (s.updated_at is null or s.updated_at < now() - interval '1 hour')
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
    left join lateral (
      select a.id, a.changed_at, a.changed_by
      from public.audit_log a
      where a.table_name = 'so_item_decorations'
        and a.op         = 'DELETE'
        and a.old_data->>'sales_order_id' = m.so_id
        and a.changed_at >= now() - interval '30 days'
      order by a.changed_at desc
      limit 1
    ) d on true
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
  );
$$;

revoke execute on function public.get_health_report() from public;
grant  execute on function public.get_health_report() to service_role;
grant  execute on function public.get_health_report() to authenticated;

comment on function public.get_health_report() is
  'System Health: returns orphan jobs and missing-deco SOs with audit-log verdicts (system_loss / user_removed / no_audit). Excludes rows in health_dismissals.';
