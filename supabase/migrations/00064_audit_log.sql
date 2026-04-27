-- Generic audit log + triggers for every critical app table.
--
-- Captures every INSERT / UPDATE / DELETE on the audited tables into a single
-- public.audit_log table, including the full old/new row as JSONB and the
-- auth.uid() of whoever made the change. Lets us answer "what was deleted,
-- when, and by whom?" forever — and recover row contents on demand.
--
-- Pairs with the application-level save guards added in app_state save logic:
-- guards prevent the known bad scenarios; this trigger captures everything
-- else (manual SQL, future code paths, supply-chain compromise) so nothing
-- ever disappears silently again.

-- ─── Audit log table ───────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id           bigserial primary key,
  table_name   text not null,
  op           text not null check (op in ('INSERT','UPDATE','DELETE')),
  row_id       text,
  old_data     jsonb,
  new_data     jsonb,
  changed_at   timestamptz not null default now(),
  changed_by   uuid
);

create index if not exists idx_audit_log_table_time on public.audit_log(table_name, changed_at desc);
create index if not exists idx_audit_log_row        on public.audit_log(table_name, row_id);
create index if not exists idx_audit_log_op_time    on public.audit_log(op, changed_at desc);
create index if not exists idx_audit_log_changed_by on public.audit_log(changed_by);

comment on table  public.audit_log is 'Append-only history of writes to audited tables. Used for recovery and forensics.';
comment on column public.audit_log.row_id is 'Stringified primary key of the affected row (extracted from old_data/new_data->>id).';

-- ─── Generic trigger function ──────────────────────────────────────────────
create or replace function public.audit_log_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id  text;
  v_uid uuid;
begin
  -- auth.uid() may be null for service_role / cron / unauthenticated jobs
  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;

  if (tg_op = 'DELETE') then
    v_old := to_jsonb(old);
    v_id  := v_old->>'id';
    insert into public.audit_log(table_name, op, row_id, old_data, changed_by)
      values (tg_table_name, 'DELETE', v_id, v_old, v_uid);
    return old;
  elsif (tg_op = 'UPDATE') then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    -- Skip no-op updates (same row content) to keep audit log signal-rich
    if v_old is distinct from v_new then
      v_id := coalesce(v_new->>'id', v_old->>'id');
      insert into public.audit_log(table_name, op, row_id, old_data, new_data, changed_by)
        values (tg_table_name, 'UPDATE', v_id, v_old, v_new, v_uid);
    end if;
    return new;
  elsif (tg_op = 'INSERT') then
    v_new := to_jsonb(new);
    v_id  := v_new->>'id';
    insert into public.audit_log(table_name, op, row_id, new_data, changed_by)
      values (tg_table_name, 'INSERT', v_id, v_new, v_uid);
    return new;
  end if;
  return null;
end;
$$;

-- ─── Attach to every critical table ────────────────────────────────────────
-- Idempotent: drop+recreate ensures re-running this migration is safe.
do $$
declare
  t text;
  audited text[] := array[
    -- Sales orders + every line/child table
    'sales_orders',
    'so_items',
    'so_item_decorations',
    'so_item_pick_lines',
    'so_item_po_lines',
    'so_jobs',
    'so_art_files',
    'so_firm_dates',
    -- Estimates + line/child tables
    'estimates',
    'estimate_items',
    'estimate_item_decorations',
    'estimate_art_files',
    -- Customers
    'customers',
    'customer_contacts',
    -- Invoices
    'invoices',
    'invoice_items',
    'invoice_payments',
    -- Catalog / org
    'products',
    'product_inventory',
    'vendors',
    'team_members',
    'price_matrix',
    'decoration_types',
    -- OMG stores
    'omg_stores',
    'omg_store_products',
    -- Issues / messaging
    'issues',
    'messages'
  ];
begin
  foreach t in array audited loop
    execute format('drop trigger if exists audit_log_trg on public.%I', t);
    execute format(
      'create trigger audit_log_trg
         after insert or update or delete on public.%I
         for each row execute function public.audit_log_trigger()',
      t
    );
  end loop;
end$$;

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.audit_log enable row level security;

drop policy if exists audit_log_service_all on public.audit_log;
create policy audit_log_service_all on public.audit_log
  for all to service_role
  using (true) with check (true);

-- Authenticated users can read entries they themselves created (helpful for
-- "what did I just change?" debugging) but cannot read other users' history
-- and cannot read system writes (changed_by null).
drop policy if exists audit_log_self_read on public.audit_log;
create policy audit_log_self_read on public.audit_log
  for select to authenticated
  using (changed_by is not null and changed_by = auth.uid());

-- No insert/update/delete from clients — only triggers (security definer) write.
revoke insert, update, delete on public.audit_log from authenticated, anon;

-- ─── Recovery helpers ──────────────────────────────────────────────────────
-- Returns rows of a given table that were deleted within a window.
create or replace function public.recover_deleted(
  p_table text,
  p_since timestamptz default (now() - interval '30 days')
)
returns table (
  row_id      text,
  deleted_at  timestamptz,
  deleted_by  uuid,
  row_data    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select row_id, changed_at, changed_by, old_data
  from public.audit_log
  where table_name = p_table
    and op = 'DELETE'
    and changed_at >= p_since
  order by changed_at desc;
$$;

grant execute on function public.recover_deleted(text, timestamptz) to service_role;

-- Returns full change history for a single row, oldest first.
create or replace function public.row_history(
  p_table text,
  p_row_id text
)
returns table (
  op          text,
  changed_at  timestamptz,
  changed_by  uuid,
  old_data    jsonb,
  new_data    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select op, changed_at, changed_by, old_data, new_data
  from public.audit_log
  where table_name = p_table
    and row_id = p_row_id
  order by changed_at asc;
$$;

grant execute on function public.row_history(text, text) to service_role;
grant execute on function public.row_history(text, text) to authenticated;

-- ─── Daily prune (180-day retention) ───────────────────────────────────────
-- Audit log grows monotonically; prune keeps it bounded. 180 days is well
-- past any reasonable "wait, where did that go?" recovery window. Adjust if
-- a longer compliance retention is needed later.
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('audit-log-prune');
exception when others then
  null;
end$$;

select cron.schedule(
  'audit-log-prune',
  '15 8 * * *', -- daily at 08:15 UTC, after the 07:00 backup
  $$delete from public.audit_log where changed_at < now() - interval '180 days'$$
);
