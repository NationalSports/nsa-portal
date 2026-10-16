-- Which orders changed, so a staff tab's backstop poll can refresh just those orders instead of
-- re-downloading the whole order book.
--
-- Live (realtime) updates already refresh one order at a time (src/App.js reloadSalesOrderDelta,
-- 2026-10-14). The 5-minute backstop poll could not: the data_versions counter only says "something
-- in the sales_orders group changed", so during business hours — when something always has — every
-- open tab still pulled all ~1,900 orders with their 7 child tables every 5 minutes (edge logs
-- 2026-10-15 14:00–22:00 UTC: 1,145 full order-book downloads next to 875 per-order ones).
--
-- One row per order: the last change number written to it. The change number is drawn from the
-- group's own counter sequence (data_version_sales_orders, migration 20261014220000), so the counter
-- value a tab recorded at its last full load doubles as its cursor: "orders with seq > that value"
-- is exactly the set written since. Every table the client assembles into an order carries a
-- row-level trigger (parent, so_* children, and the so_item_* grandchildren through their item's
-- so_id), so a PO line inserted on its own — which deliberately does not touch the order row —
-- is seen too.
--
-- Sound under concurrency for the same reason data_versions() is: the trigger takes the group's
-- SHARED advisory lock before drawing a number, and data_versions() reports the group as null (=
-- unknown, reload) while any such writer is still uncommitted. So when a tab reads a non-null
-- counter V, every change numbered ≤ V has already committed or rolled back; nothing numbered
-- ≤ V can appear later. Numbers above V belong to writers that started after the read and are
-- picked up by the next poll (their commits move the counter past V).
--
-- Rows are never deleted: a deleted order keeps its row with a fresh number, so a tab asking for
-- that order finds no row and falls back to the full reload, which is how deletions reach it.
-- Read by staff only (same rule as the orders themselves); written only by the trigger.

begin;

create table if not exists public.so_changes (
  so_id text primary key,
  seq bigint not null
);
create index if not exists so_changes_seq_idx on public.so_changes (seq);

alter table public.so_changes enable row level security;
revoke all on public.so_changes from public, anon, authenticated;
grant select on public.so_changes to authenticated, service_role;
drop policy if exists so_changes_staff_read on public.so_changes;
create policy so_changes_staff_read on public.so_changes
  for select to authenticated using ((select public.is_team_member()));

-- tg_argv[0]: the column that names the order — 'id' (sales_orders), 'so_id' (its children) or
-- 'so_item_id' (grandchildren, resolved through so_items). Runs AFTER the row change, so on a delete
-- of a grandchild its item row is still there to resolve against (the save RPC and the delete helper
-- both remove grandchildren before items); a cascade that already took the item is simply skipped —
-- the order's own row trigger has recorded that change.
create or replace function public.note_so_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_so text;
begin
  if tg_argv[0] = 'id' then
    v_so := coalesce(new.id, old.id);
  elsif tg_argv[0] = 'so_id' then
    v_so := coalesce(new.so_id, old.so_id);
  else
    select i.so_id into v_so from public.so_items i where i.id = coalesce(new.so_item_id, old.so_item_id);
  end if;
  if v_so is null then return null; end if;
  -- Held until this transaction ends: data_versions() reports the group as in flight meanwhile.
  perform pg_advisory_xact_lock_shared(7421, public.data_version_lock_key('sales_orders'));
  insert into public.so_changes (so_id, seq) values (v_so, nextval('public.data_version_sales_orders'))
    on conflict (so_id) do update set seq = excluded.seq;
  return null;
end $$;
revoke all on function public.note_so_change() from public, anon, authenticated;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('sales_orders','id'),
    ('so_art_files','so_id'), ('so_firm_dates','so_id'), ('so_items','so_id'), ('so_jobs','so_id'),
    ('so_item_decorations','so_item_id'), ('so_item_pick_lines','so_item_id'), ('so_item_po_lines','so_item_id')
  ) as t(tbl, col) loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_so_change', r.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I '
                   'for each row execute function public.note_so_change(%L)',
                   r.tbl || '_so_change', r.tbl, r.col);
  end loop;
end $$;

commit;
