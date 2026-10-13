-- Durable orchestration and observability for both writers to adidas_inventory.
-- This migration is intentionally service-role only: sync state, lock tokens,
-- and failure details must not be exposed through the public Data API.

-- The original 00045 migration now declares the same text id/source shape as
-- the live table. Add source forward for older installs, and fail loudly rather
-- than attempting a destructive type change underneath dependent storefront
-- views if an unsupported serial-id schema somehow reaches this migration.
alter table public.adidas_inventory add column if not exists source text;

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'adidas_inventory'
       and column_name = 'id'
       and data_type <> 'text'
  ) then
    raise exception
      'adidas_inventory.id must be text before applying sync reliability migration';
  end if;
end;
$$;

create table public.adidas_inventory_sync_state (
  source text primary key
    check (source in ('ss_activewear', 'api-materials')),
  cursor jsonb not null default '{}'::jsonb,
  cycle_started_at timestamptz,
  last_progress_at timestamptz,
  last_cycle_completed_at timestamptz,
  lock_owner uuid,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.adidas_inventory_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null
    check (source in ('ss_activewear', 'api-materials')),
  status text not null default 'running'
    check (status in (
      'running', 'success', 'completed', 'partial', 'failed',
      'auth_required', 'skipped_locked'
    )),
  lock_owner uuid,
  styles_total integer not null default 0 check (styles_total >= 0),
  styles_processed integer not null default 0 check (styles_processed >= 0),
  products_upserted integer not null default 0 check (products_upserted >= 0),
  inventory_rows integer not null default 0 check (inventory_rows >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  errors jsonb not null default '[]'::jsonb,
  cycle_completed boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index adidas_inventory_sync_runs_source_started_idx
  on public.adidas_inventory_sync_runs (source, started_at desc);
create index adidas_inventory_sync_runs_success_idx
  on public.adidas_inventory_sync_runs (source, finished_at desc)
  where status in ('success', 'completed');

create table public.adidas_inventory_guard_drops (
  bucket_at timestamptz not null,
  source text not null,
  reason text not null
    check (reason in ('raw_size_code', 'invalid_extended_size')),
  drop_count bigint not null default 0 check (drop_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  sample_sku text,
  sample_size text,
  primary key (bucket_at, source, reason)
);

create index adidas_inventory_guard_drops_recent_idx
  on public.adidas_inventory_guard_drops (last_seen_at desc);

alter table public.adidas_inventory_sync_state enable row level security;
alter table public.adidas_inventory_sync_runs enable row level security;
alter table public.adidas_inventory_guard_drops enable row level security;

revoke all on public.adidas_inventory_sync_state from anon, authenticated;
revoke all on public.adidas_inventory_sync_runs from anon, authenticated;
revoke all on public.adidas_inventory_guard_drops from anon, authenticated;
grant all on public.adidas_inventory_sync_state to service_role;
grant all on public.adidas_inventory_sync_runs to service_role;
grant all on public.adidas_inventory_guard_drops to service_role;

insert into public.adidas_inventory_sync_state (source, cycle_started_at)
values
  ('ss_activewear', now()),
  ('api-materials', now())
on conflict (source) do nothing;

create or replace function public.claim_adidas_inventory_sync(
  p_source text,
  p_owner uuid,
  p_ttl_seconds integer default 1200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.adidas_inventory_sync_state%rowtype;
begin
  if p_source not in ('ss_activewear', 'api-materials') then
    raise exception 'unsupported adidas inventory source';
  end if;
  if p_ttl_seconds < 60 or p_ttl_seconds > 3600 then
    raise exception 'lock ttl must be between 60 and 3600 seconds';
  end if;

  insert into public.adidas_inventory_sync_state (source, cycle_started_at)
  values (p_source, clock_timestamp())
  on conflict (source) do nothing;

  update public.adidas_inventory_sync_state
     set lock_owner = p_owner,
         locked_until = clock_timestamp() + make_interval(secs => p_ttl_seconds),
         cycle_started_at = coalesce(cycle_started_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where source = p_source
     and (locked_until is null or locked_until < clock_timestamp() or lock_owner = p_owner)
  returning * into v_state;

  if found then
    return jsonb_build_object(
      'acquired', true,
      'locked_until', v_state.locked_until,
      'cursor', v_state.cursor
    );
  end if;

  select * into v_state
    from public.adidas_inventory_sync_state
   where source = p_source;
  return jsonb_build_object(
    'acquired', false,
    'locked_until', v_state.locked_until
  );
end;
$$;

create or replace function public.checkpoint_adidas_inventory_sync(
  p_source text,
  p_owner uuid,
  p_cursor jsonb,
  p_cycle_completed boolean default false,
  p_ttl_seconds integer default 1200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  update public.adidas_inventory_sync_state
     set cursor = coalesce(p_cursor, '{}'::jsonb),
         last_progress_at = clock_timestamp(),
         last_cycle_completed_at = case
           when p_cycle_completed then clock_timestamp()
           else last_cycle_completed_at
         end,
         cycle_started_at = case
           when p_cycle_completed then null
           else coalesce(cycle_started_at, clock_timestamp())
         end,
         locked_until = clock_timestamp() + make_interval(secs => p_ttl_seconds),
         updated_at = clock_timestamp()
   where source = p_source
     and lock_owner = p_owner
     and locked_until >= clock_timestamp();
  v_updated := found;
  return jsonb_build_object('updated', v_updated);
end;
$$;

create or replace function public.release_adidas_inventory_sync(
  p_source text,
  p_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released boolean;
begin
  update public.adidas_inventory_sync_state
     set lock_owner = null,
         locked_until = null,
         updated_at = clock_timestamp()
   where source = p_source
     and lock_owner = p_owner;
  v_released := found;
  return jsonb_build_object('released', v_released);
end;
$$;

revoke all on function public.claim_adidas_inventory_sync(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.checkpoint_adidas_inventory_sync(text, uuid, jsonb, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.release_adidas_inventory_sync(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_adidas_inventory_sync(text, uuid, integer)
  to service_role;
grant execute on function public.checkpoint_adidas_inventory_sync(text, uuid, jsonb, boolean, integer)
  to service_role;
grant execute on function public.release_adidas_inventory_sync(text, uuid)
  to service_role;

-- Preserve migration 00165's exact rejection and clamp behavior, but aggregate
-- rejected rows by hour/source/reason so a 2xx upsert can no longer hide loss.
create or replace function public.adidas_inventory_write_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_bucket timestamptz := date_trunc('hour', clock_timestamp());
begin
  if new.size ~ '^[0-9]{3}$' then
    v_reason := 'raw_size_code';
  elsif upper(new.size) in ('6XL', '7XL') then
    v_reason := 'invalid_extended_size';
  end if;

  if v_reason is not null then
    insert into public.adidas_inventory_guard_drops (
      bucket_at, source, reason, drop_count, sample_sku, sample_size
    )
    values (
      v_bucket, coalesce(nullif(new.source, ''), 'unknown'),
      v_reason, 1, new.sku, new.size
    )
    on conflict (bucket_at, source, reason) do update
      set drop_count = public.adidas_inventory_guard_drops.drop_count + 1,
          last_seen_at = clock_timestamp(),
          sample_sku = excluded.sample_sku,
          sample_size = excluded.sample_size;
    return null;
  end if;

  if new.stock_qty >= 1000000 then new.stock_qty := 9999; end if;
  if new.future_delivery_qty >= 1000000 then new.future_delivery_qty := null; end if;
  return new;
end;
$$;

revoke all on function public.adidas_inventory_write_guard()
  from public, anon, authenticated;

comment on table public.adidas_inventory_sync_state is
  'Service-only cursors and expiring run locks for Adidas inventory sources.';
comment on table public.adidas_inventory_sync_runs is
  'Service-only per-run status and coverage counters for Adidas inventory syncs.';
comment on table public.adidas_inventory_guard_drops is
  'Hourly aggregate of rows rejected by trg_adidas_inventory_guard.';
