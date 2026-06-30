-- Fixes a false-positive in get_health_report().
--
-- Old logic flagged every job on an SO if the SO had zero so_item_decorations rows
-- across all items combined, regardless of whether the job's art_file_id actually
-- pointed anywhere. This produced spurious orphan alerts for booking-status SOs
-- (where jobs are created through the wizard before item-level decorations are
-- finalized) and any SO whose decorations live elsewhere.
--
-- New logic: a job is an orphan only when its art_file_id is set, is not the
-- placeholder '__tbd', and no decoration on the same SO references it.

create or replace function public.get_health_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with orphans as (
    select
      j.id as job_id,
      j.so_id,
      j.art_name,
      s.memo,
      s.status as so_status
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
  so_item_stats as (
    select
      s.id as so_id,
      s.memo,
      s.status,
      s.updated_at,
      count(i.id) as total_items,
      count(i.id) filter (where coalesce(i.no_deco, false) = false
                           and not exists (select 1 from so_item_decorations d2 where d2.so_item_id = i.id)) as missing_items
    from sales_orders s
    join so_items i on i.so_id = s.id
    where s.deleted_at is null
      and s.status in ('need_order','waiting_receive','needs_pull','items_received','in_production','ready_to_invoice')
      and (s.updated_at is null or s.updated_at < now() - interval '1 hour')
    group by s.id, s.memo, s.status, s.updated_at
  ),
  missing_deco as (
    select so_id, memo, status, total_items, missing_items
    from so_item_stats
    where total_items > 0 and missing_items::numeric / total_items > 0.5
  )
  select jsonb_build_object(
    'generated_at', now(),
    'orphan_jobs', coalesce((select jsonb_agg(to_jsonb(o)) from orphans o), '[]'::jsonb),
    'missing_deco_sos', coalesce((select jsonb_agg(to_jsonb(m)) from missing_deco m), '[]'::jsonb),
    'orphan_count', (select count(*) from orphans),
    'missing_deco_count', (select count(*) from missing_deco)
  );
$$;

grant execute on function public.get_health_report() to service_role;
grant execute on function public.get_health_report() to authenticated;
