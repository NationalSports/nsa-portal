-- Change counters for the staff app's reload groups, so a tab can skip re-downloading data that
-- has not changed.
--
-- Every open staff tab re-downloads the whole order book (all sales orders + 7 child tables, all
-- estimates + 3, all invoices + 3, all messages + reads) on its 5-minute backstop poll and on
-- tab focus, whether or not anything changed. On 2026-10-14 (18:00-20:00 UTC, 11 tabs) that was
-- ~half of 628 full sales-order downloads; realtime-triggered reloads were the other half.
--
-- One sequence per load group, bumped by a statement-level trigger on every table the client
-- loads for that group (src/lib/dbEngine.js _dbLoad `_grp(...)` lists — keep in sync). Sequences
-- are non-transactional and lock-free, so concurrent saves never wait on each other here; a
-- rolled-back write still bumps the counter, which only costs one harmless extra reload.
-- data_versions() returns the current counters; the client compares them with the counters it
-- read just before its last successful load of each group (src/lib/dataVersions.js).
--
-- In-flight writers. Because the bump is visible before the writer commits, a tab could read the
-- bumped counter, then read rows from a snapshot that does not include the write yet (the
-- multi-statement save RPCs hold a transaction open for tens to hundreds of ms), and record that
-- counter as "current" — and then skip the very reload that would have shown the write. So the
-- trigger also takes a SHARED transaction-scoped advisory lock on the group (writers never block
-- each other), and data_versions() reports a group as null (= unknown, reload) whenever it cannot
-- take the exclusive one, i.e. while any writer to that group is still uncommitted. The try-lock
-- never waits; a writer arriving during data_versions() waits microseconds. The int4-pair key
-- space (class 7421) is separate from the bigint advisory keys the app's RPCs use.
--
-- Not covered (by design, costs at most one 30-minute full sync of staleness): bulk loads run
-- with session_replication_role = replica, which skip all triggers.
--
-- app_state is shared by many writers (QuickBooks scratch rows, image fallbacks...), so its
-- counter only moves for the keys the poll actually applies — the list in src/App.js runPoll
-- (`as.inv_pos` ... `as.company_info`). A key added there must be added here too; until it is,
-- that key refreshes on the 30-minute full sync instead of every poll.

begin;

do $$
declare g text;
begin
  foreach g in array array['estimates','sales_orders','invoices','messages','assigned_todos','app_state'] loop
    execute format('create sequence if not exists public.%I', 'data_version_' || g);
    -- Start "called", so the very first bump moves last_value (1 -> 2).
    execute format('select nextval(%L)', 'public.data_version_' || g);
    -- Supabase's default privileges grant sequences to anon/authenticated; only the trigger bumps these.
    execute format('revoke all on sequence public.%I from public, anon, authenticated', 'data_version_' || g);
  end loop;
end $$;

-- Lock key per group (int4 pair: class 7421, this number). Keep in step with data_versions().
create or replace function public.data_version_lock_key(p_group text)
returns integer
language sql
immutable
as $$
  select array_position(array['estimates','sales_orders','invoices','messages','assigned_todos','app_state'], p_group)
$$;

create or replace function public.bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Held until this transaction ends: data_versions() reports the group as in flight meanwhile.
  perform pg_advisory_xact_lock_shared(7421, public.data_version_lock_key(tg_argv[1]));
  perform nextval(tg_argv[0]::regclass);
  return null;
end $$;
revoke all on function public.bump_data_version() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('estimates','estimates'), ('estimate_art_files','estimates'), ('estimate_items','estimates'),
    ('estimate_item_decorations','estimates'),
    ('sales_orders','sales_orders'), ('so_art_files','sales_orders'), ('so_firm_dates','sales_orders'),
    ('so_items','sales_orders'), ('so_item_decorations','sales_orders'), ('so_item_pick_lines','sales_orders'),
    ('so_item_po_lines','sales_orders'), ('so_jobs','sales_orders'),
    ('invoices','invoices'), ('invoice_payments','invoices'), ('invoice_items','invoices'),
    ('invoice_credit_memos','invoices'),
    ('messages','messages'), ('message_reads','messages'),
    ('assigned_todos','assigned_todos'), ('todo_comments','assigned_todos')
  ) as t(tbl, grp) loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_data_version', r.tbl);
    execute format('create trigger %I after insert or update or delete or truncate on public.%I '
                   'for each statement execute function public.bump_data_version(%L, %L)',
                   r.tbl || '_data_version', r.tbl, 'public.data_version_' || r.grp, r.grp);
  end loop;
end $$;

-- app_state: row-level, only for the keys the poll applies (see header).
drop trigger if exists app_state_data_version_new on public.app_state;
create trigger app_state_data_version_new after insert or update on public.app_state
  for each row when (new.id in ('inv_pos','inv_adj_log','inv_po_counter','submitted_batches','batch_pos','company_info'))
  execute function public.bump_data_version('public.data_version_app_state', 'app_state');
drop trigger if exists app_state_data_version_old on public.app_state;
create trigger app_state_data_version_old after update or delete on public.app_state
  for each row when (old.id in ('inv_pos','inv_adj_log','inv_po_counter','submitted_batches','batch_pos','company_info'))
  execute function public.bump_data_version('public.data_version_app_state', 'app_state');

-- A group's counter, or null while a writer to it is still uncommitted (see header).
create or replace function public.data_version_of(p_group text, p_seq regclass)
returns bigint
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v bigint;
begin
  if not pg_try_advisory_xact_lock(7421, public.data_version_lock_key(p_group)) then return null; end if;
  execute format('select last_value from %s', p_seq) into v;
  return v;
end $$;
revoke all on function public.data_version_of(text, regclass) from public, anon, authenticated;

create or replace function public.data_versions()
returns jsonb
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'estimates', public.data_version_of('estimates', 'public.data_version_estimates'),
    'sales_orders', public.data_version_of('sales_orders', 'public.data_version_sales_orders'),
    'invoices', public.data_version_of('invoices', 'public.data_version_invoices'),
    'messages', public.data_version_of('messages', 'public.data_version_messages'),
    'assigned_todos', public.data_version_of('assigned_todos', 'public.data_version_assigned_todos'),
    'app_state', public.data_version_of('app_state', 'public.data_version_app_state'))
$$;
revoke all on function public.data_versions() from public, anon;
grant execute on function public.data_versions() to authenticated, service_role;

commit;
