-- Deterministic adidas CLICK cart plans: saved garment variants plus a database
-- wake-up for Hold & re-check tasks. This migration is intentionally safe to
-- deploy before the Grok runner; it never submits an order or changes inventory.

begin;

create table if not exists public.adidas_click_size_preferences (
  sku text primary key,
  variant text not null check (length(trim(variant)) > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.adidas_click_size_preferences enable row level security;
drop policy if exists adidas_click_size_preferences_staff on public.adidas_click_size_preferences;
create policy adidas_click_size_preferences_staff
  on public.adidas_click_size_preferences
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());

revoke all on table public.adidas_click_size_preferences from anon;
grant select, insert, update, delete on table public.adidas_click_size_preferences to authenticated;
grant all on table public.adidas_click_size_preferences to service_role;

comment on table public.adidas_click_size_preferences is
  'Saved CLICK garment variant/inseam by adidas article (for example IS1111 -> 7).';

create or replace function public.requeue_ready_adidas_click_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  task record;
  is_ready boolean;
  requeued integer := 0;
begin
  for task in
    select id, bot_payload
      from public.assigned_todos
     where status = 'open'
       and bot_status = 'scheduled'
       and bot_payload->>'task_type' = 'adidas_click_cart_v2'
       and coalesce((bot_payload->>'scheduled_for')::timestamptz, now()) <= now()
     order by created_at
     for update skip locked
  loop
    select coalesce(bool_and(coalesce(inv.stock_qty, 0) >= (requested.value->>'qty')::integer), false)
      into is_ready
      from jsonb_array_elements(coalesce(task.bot_payload->'resolved_plan'->'sku_plans', '[]'::jsonb)) sku_plan
      cross join lateral jsonb_array_elements(coalesce(sku_plan.value->'requested', '[]'::jsonb)) requested
      left join public.adidas_inventory inv
        on inv.sku = sku_plan.value->>'sku'
       and inv.size = requested.value->>'click_size';

    if is_ready then
      update public.assigned_todos
         set bot_status = 'queued',
             bot_payload = jsonb_set(
               task.bot_payload - 'scheduled_for',
               '{resolved_plan,import_rows}',
               coalesce((
                 select jsonb_agg(import_row.value || jsonb_build_object('rdd', current_date::text))
                   from jsonb_array_elements(coalesce(task.bot_payload->'resolved_plan'->'import_rows', '[]'::jsonb)) import_row
               ), '[]'::jsonb),
               true
             ),
             updated_at = now()
       where id = task.id
         and bot_status = 'scheduled';
      if found then requeued := requeued + 1; end if;
    else
      update public.assigned_todos
         set bot_payload = jsonb_set(
               task.bot_payload,
               '{scheduled_for}',
               to_jsonb(date_trunc('day', now() + interval '1 day') + interval '12 hours'),
               true
             ),
             updated_at = now()
       where id = task.id
         and bot_status = 'scheduled';
    end if;
  end loop;

  return requeued;
end;
$function$;

revoke all on function public.requeue_ready_adidas_click_tasks() from public, anon, authenticated;
grant execute on function public.requeue_ready_adidas_click_tasks() to service_role;

select cron.schedule(
  'requeue-ready-adidas-click-tasks',
  '17 * * * *',
  $cron$select public.requeue_ready_adidas_click_tasks()$cron$
);

commit;
