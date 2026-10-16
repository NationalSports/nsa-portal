-- Scenarios for migration 20261016150000_so_changes.sql. Self-contained: builds every table the
-- staff app loads per reload group (the data_versions migration needs them all), applies both
-- migrations, and checks that every write to an order's eight tables records that order with a
-- number above the counter a tab read before the write, that the "orders since my counter" read a
-- poll makes returns exactly the orders written since, that an uncommitted writer can never be
-- missed, and who may read the rows. SCRATCH DATABASE ONLY.
--
--   psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/so_changes_scenarios.sql
--
-- Ends with ALL_SO_CHANGE_SCENARIOS_PASSED.

\set QUIET on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;

-- Staff check stub: on when test.staff = 'on'.
create or replace function public.is_team_member() returns boolean language sql stable as $$
  select current_setting('test.staff', true) = 'on' $$;

do $$
declare t text;
begin
  foreach t in array array['estimates','estimate_art_files','estimate_items','estimate_item_decorations',
    'invoices','invoice_payments','invoice_items','invoice_credit_memos',
    'messages','message_reads','assigned_todos','todo_comments'] loop
    execute format('create table public.%I (id text primary key, v int)', t);
  end loop;
end $$;
create table public.app_state (id text primary key, value text);
-- The order tables, shaped as in production (keys and parent columns).
create table public.sales_orders (id text primary key, memo text, _version int default 1);
create table public.so_art_files (so_id text references public.sales_orders(id) on delete cascade, id text, v int, primary key (so_id, id));
create table public.so_firm_dates (id serial primary key, so_id text references public.sales_orders(id) on delete cascade, v int);
create table public.so_jobs (so_id text references public.sales_orders(id) on delete cascade, id text, v int, primary key (so_id, id));
create table public.so_items (id serial primary key, so_id text references public.sales_orders(id) on delete cascade, v int);
create table public.so_item_decorations (id serial primary key, so_item_id int references public.so_items(id) on delete cascade, v int);
create table public.so_item_pick_lines (id serial primary key, so_item_id int references public.so_items(id) on delete cascade, v int);
create table public.so_item_po_lines (id serial primary key, so_item_id int references public.so_items(id) on delete cascade, v int);
do $$
declare t text;
begin
  foreach t in array array['sales_orders','so_art_files','so_firm_dates','so_jobs','so_items','so_item_decorations','so_item_pick_lines','so_item_po_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_all', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;

\i supabase/migrations/20261014220000_data_versions.sql
\i supabase/migrations/20261016150000_so_changes.sql
\i supabase/migrations/20261016150000_so_changes.sql

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'SCENARIO FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create or replace function pg_temp.v() returns bigint language sql as $$ select (public.data_versions()->>'sales_orders')::bigint $$;
-- What the poll reads: orders written since the counter it recorded.
create or replace function pg_temp.since(p bigint) returns text[] language sql as $$
  select coalesce(array_agg(so_id order by so_id), '{}') from public.so_changes where seq > p $$;

select pg_temp.expect((select count(*) from pg_trigger where tgname like '%_so_change' and not tgisinternal) = 8, '8 triggers, none duplicated by the re-run');

insert into public.sales_orders (id) values ('SO-1'), ('SO-2'), ('SO-3');
insert into public.so_items (so_id, v) values ('SO-1', 1), ('SO-2', 1);

-- 1. Every write kind on every one of the eight tables records exactly its order, numbered above the
--    counter read before the write (as the staff role, through RLS).
select set_config('test.staff', 'on', false);
set role authenticated;
do $$
declare
  r record; op text; v0 bigint; got text[]; item1 int; item2 int;
begin
  select id into item1 from public.so_items where so_id = 'SO-1';
  select id into item2 from public.so_items where so_id = 'SO-2';
  for r in select * from (values
    ('sales_orders', 'update public.sales_orders set memo = %L where id = ''SO-1x''','insert into public.sales_orders (id, memo) values (''SO-1x'', %L)', 'delete from public.sales_orders where id = ''SO-1x''', 'SO-1x'),
    ('so_art_files', 'update public.so_art_files set v = 2 where so_id = ''SO-1''', 'insert into public.so_art_files (so_id, id, v) values (''SO-1'', %L, 1)', 'delete from public.so_art_files where so_id = ''SO-1''', 'SO-1'),
    ('so_firm_dates', 'update public.so_firm_dates set v = 2 where so_id = ''SO-1''', 'insert into public.so_firm_dates (so_id, v) values (''SO-1'', 1) -- %L', 'delete from public.so_firm_dates where so_id = ''SO-1''', 'SO-1'),
    ('so_jobs', 'update public.so_jobs set v = 2 where so_id = ''SO-1''', 'insert into public.so_jobs (so_id, id, v) values (''SO-1'', %L, 1)', 'delete from public.so_jobs where so_id = ''SO-1''', 'SO-1'),
    ('so_items', 'update public.so_items set v = 2 where so_id = ''SO-2''', 'insert into public.so_items (so_id, v) values (''SO-2'', 9) -- %L', 'delete from public.so_items where id = (select max(id) from public.so_items where so_id = ''SO-2'')', 'SO-2')
  ) as t(tbl, upd, ins, del, so) loop
    foreach op in array array['ins', 'upd', 'del'] loop
      v0 := pg_temp.v();
      execute format(case op when 'ins' then r.ins when 'upd' then r.upd else r.del end, 'x' || clock_timestamp()::text);
      got := pg_temp.since(v0);
      if got <> array[r.so] then raise exception 'SCENARIO FAILED: % on % recorded %, expected {%}', op, r.tbl, got, r.so; end if;
    end loop;
  end loop;
  -- Grandchildren resolve through their item to the order.
  for r in select * from (values ('so_item_decorations'), ('so_item_pick_lines'), ('so_item_po_lines')) as t(tbl) loop
    v0 := pg_temp.v(); execute format('insert into public.%I (so_item_id, v) values (%s, 1)', r.tbl, item1);
    if pg_temp.since(v0) <> array['SO-1'] then raise exception 'SCENARIO FAILED: insert on % did not record SO-1', r.tbl; end if;
    v0 := pg_temp.v(); execute format('update public.%I set v = 2 where so_item_id = %s', r.tbl, item1);
    if pg_temp.since(v0) <> array['SO-1'] then raise exception 'SCENARIO FAILED: update on % did not record SO-1', r.tbl; end if;
    v0 := pg_temp.v(); execute format('delete from public.%I where so_item_id = %s', r.tbl, item1);
    if pg_temp.since(v0) <> array['SO-1'] then raise exception 'SCENARIO FAILED: delete on % did not record SO-1', r.tbl; end if;
  end loop;
  -- A write to another order records only that order; an untouched order is never reported.
  v0 := pg_temp.v(); execute format('insert into public.so_item_po_lines (so_item_id, v) values (%s, 1)', item2);
  if pg_temp.since(v0) <> array['SO-2'] then raise exception 'SCENARIO FAILED: a PO line on SO-2 recorded %', pg_temp.since(v0); end if;
  raise notice 'ok: insert/update/delete on all 8 order tables record exactly their order, numbered above the counter read before the write (as staff, through RLS)';
end $$;
reset role;

-- 2. The poll's read: a cursor taken between writes returns exactly the orders written after it, each
--    once, and a cursor taken after everything returns nothing.
do $$
declare v0 bigint; v1 bigint;
begin
  v0 := pg_temp.v();
  update public.sales_orders set memo = 'a' where id = 'SO-3';
  update public.sales_orders set memo = 'b' where id = 'SO-3';
  v1 := pg_temp.v();
  update public.sales_orders set memo = 'c' where id = 'SO-2';
  if pg_temp.since(v0) <> array['SO-2', 'SO-3'] then raise exception 'SCENARIO FAILED: since v0 = %', pg_temp.since(v0); end if;
  if pg_temp.since(v1) <> array['SO-2'] then raise exception 'SCENARIO FAILED: since v1 = %', pg_temp.since(v1); end if;
  if pg_temp.since(pg_temp.v()) <> '{}' then raise exception 'SCENARIO FAILED: a current cursor still reports orders'; end if;
  if (select count(*) from public.so_changes where so_id = 'SO-3') <> 1 then raise exception 'SCENARIO FAILED: one row per order'; end if;
  raise notice 'ok: "orders since my counter" returns exactly the orders written after it, once each';
end $$;

-- 3. A deleted order keeps a row with a fresh number, so a tab that asks for it finds no order row
--    and falls back to the full reload (its cascade-deleted children do not error).
do $$ declare v0 bigint := pg_temp.v(); begin
  insert into public.so_items (so_id, v) values ('SO-3', 1);
  insert into public.so_item_decorations (so_item_id, v) select id, 1 from public.so_items where so_id = 'SO-3';
  v0 := pg_temp.v();
  delete from public.sales_orders where id = 'SO-3';
  if pg_temp.since(v0) <> array['SO-3'] then raise exception 'SCENARIO FAILED: deleting SO-3 recorded %', pg_temp.since(v0); end if;
  raise notice 'ok: deleting an order (with cascading children) records it, so the poll notices the deletion';
end $$;

-- 4. An uncommitted writer can never be missed. While it is open, the counter reads null (the poll
--    keeps its old cursor); after it commits, its order is numbered above the old cursor even though a
--    later writer committed first. Second session via dblink.
create extension if not exists dblink;
select dblink_connect('w', 'host=/tmp/pgtest-reads port=54999 dbname=' || current_database() || ' user=postgres');
create temp table cur as select pg_temp.v() as v0;
select dblink_exec('w', 'begin');
select dblink_exec('w', 'update public.sales_orders set memo = ''open'' where id = ''SO-1''');
update public.sales_orders set memo = 'closed first' where id = 'SO-2';
select pg_temp.expect((public.data_versions()->>'sales_orders') is null, 'while a save is open the counter reads null, so the poll keeps its cursor');
select pg_temp.expect(pg_temp.since((select v0 from cur)) = array['SO-2'], 'and only the committed order is visible so far');
select dblink_exec('w', 'commit');
select pg_temp.expect(pg_temp.since((select v0 from cur)) = array['SO-1', 'SO-2'], 'after it commits the old cursor sees both orders');
select pg_temp.expect(pg_temp.since(pg_temp.v()) = '{}', 'and a cursor taken now sees neither');
select dblink_exec('w', 'begin');
select dblink_exec('w', 'update public.sales_orders set memo = ''rolled back'' where id = ''SO-1''');
select dblink_exec('w', 'rollback');
select pg_temp.expect((public.data_versions()->>'sales_orders') is not null, 'a rolled-back writer releases the group');
select dblink_disconnect('w');

-- 5. Who can read the rows: staff only; nobody but the trigger writes them.
set role anon;
do $$ begin perform count(*) from public.so_changes; raise exception 'SCENARIO FAILED: anon read so_changes';
exception when insufficient_privilege then raise notice 'ok: anon cannot read so_changes'; end $$;
reset role;
set role authenticated;
select set_config('test.staff', 'off', false);
select pg_temp.expect((select count(*) from public.so_changes) = 0, 'a signed-in non-staff user reads no rows');
select set_config('test.staff', 'on', false);
select pg_temp.expect((select count(*) from public.so_changes) >= 3, 'staff read the rows');
do $$ begin insert into public.so_changes values ('SO-9', 1); raise exception 'SCENARIO FAILED: authenticated wrote so_changes';
exception when insufficient_privilege then raise notice 'ok: authenticated cannot write so_changes directly'; end $$;
do $$ begin delete from public.so_changes; raise exception 'SCENARIO FAILED: authenticated deleted so_changes';
exception when insufficient_privilege then raise notice 'ok: authenticated cannot delete so_changes rows'; end $$;
reset role;

\echo ALL_SO_CHANGE_SCENARIOS_PASSED
