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

-- Browser-safe projection of sync freshness. The reliability run table is
-- service-role only because it contains errors and lock details; expose only
-- the last error-free finish time needed by order screens.
create table if not exists public.adidas_inventory_freshness (
  source text primary key,
  last_success_at timestamptz not null
);

alter table public.adidas_inventory_freshness enable row level security;
drop policy if exists adidas_inventory_freshness_read on public.adidas_inventory_freshness;
create policy adidas_inventory_freshness_read
  on public.adidas_inventory_freshness
  for select
  to anon, authenticated
  using (true);

revoke all on table public.adidas_inventory_freshness from anon, authenticated;
grant select on table public.adidas_inventory_freshness to anon, authenticated;
grant all on table public.adidas_inventory_freshness to service_role;

create or replace function public.capture_adidas_inventory_freshness()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status in ('success', 'completed')
     and new.error_count = 0
     and new.finished_at is not null then
    insert into public.adidas_inventory_freshness (source, last_success_at)
    values (new.source, new.finished_at)
    on conflict (source) do update
      set last_success_at = greatest(
        public.adidas_inventory_freshness.last_success_at,
        excluded.last_success_at
      );
  end if;
  return new;
end;
$function$;

revoke all on function public.capture_adidas_inventory_freshness() from public, anon, authenticated;

-- PR #2526 owns this service-only table and has already been applied in
-- production. Keep this migration usable before that PR merges into a fresh
-- checkout; once both files are present its earlier timestamp runs first.
do $block$
begin
  if to_regclass('public.adidas_inventory_sync_runs') is not null then
    execute $sql$
      insert into public.adidas_inventory_freshness (source, last_success_at)
      select distinct on (source) source, finished_at
        from public.adidas_inventory_sync_runs
       where status in ('success', 'completed')
         and error_count = 0
         and finished_at is not null
       order by source, finished_at desc
      on conflict (source) do update
        set last_success_at = greatest(
          public.adidas_inventory_freshness.last_success_at,
          excluded.last_success_at
        )
    $sql$;
    execute 'drop trigger if exists trg_adidas_inventory_run_freshness on public.adidas_inventory_sync_runs';
    execute $sql$
      create trigger trg_adidas_inventory_run_freshness
      after insert or update of status, error_count, finished_at
      on public.adidas_inventory_sync_runs
      for each row execute function public.capture_adidas_inventory_freshness()
    $sql$;
  end if;
end;
$block$;

select cron.schedule(
  'requeue-ready-adidas-click-tasks',
  '17 * * * *',
  $cron$select public.requeue_ready_adidas_click_tasks()$cron$
);

commit;
