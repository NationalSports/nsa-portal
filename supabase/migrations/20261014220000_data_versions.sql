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
  end loop;
end $$;

create or replace function public.bump_data_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
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
                   'for each statement execute function public.bump_data_version(%L)',
                   r.tbl || '_data_version', r.tbl, 'public.data_version_' || r.grp);
  end loop;
end $$;

-- app_state: row-level, only for the keys the poll applies (see header).
drop trigger if exists app_state_data_version_new on public.app_state;
create trigger app_state_data_version_new after insert or update on public.app_state
  for each row when (new.id in ('inv_pos','inv_adj_log','inv_po_counter','submitted_batches','batch_pos','company_info'))
  execute function public.bump_data_version('public.data_version_app_state');
drop trigger if exists app_state_data_version_old on public.app_state;
create trigger app_state_data_version_old after update or delete on public.app_state
  for each row when (old.id in ('inv_pos','inv_adj_log','inv_po_counter','submitted_batches','batch_pos','company_info'))
  execute function public.bump_data_version('public.data_version_app_state');

create or replace function public.data_versions()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'estimates', (select last_value from public.data_version_estimates),
    'sales_orders', (select last_value from public.data_version_sales_orders),
    'invoices', (select last_value from public.data_version_invoices),
    'messages', (select last_value from public.data_version_messages),
    'assigned_todos', (select last_value from public.data_version_assigned_todos),
    'app_state', (select last_value from public.data_version_app_state))
$$;
revoke all on function public.data_versions() from public, anon;
grant execute on function public.data_versions() to authenticated, service_role;

commit;
