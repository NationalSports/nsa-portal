-- Health check RPC for the System Health monitor + scheduled Netlify alert.
-- Returns a jsonb with:
--   orphan_jobs: so_jobs whose art_file_id doesn't exist on any live decoration
--   missing_deco_sos: active SOs where >50% of items have no decoration (and aren't flagged no_deco)

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
    left join so_items i on i.so_id = j.so_id
    left join so_item_decorations d on d.so_item_id = i.id
    group by j.id, j.so_id, j.art_name, s.memo, s.status
    having count(d.id) = 0
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
