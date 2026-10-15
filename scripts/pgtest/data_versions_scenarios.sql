-- Scenarios for migration 20261014220000_data_versions.sql. Self-contained: builds every table the
-- staff app loads per reload group, applies the migration, and checks that each kind of write to
-- each table moves exactly its group's counter, that app_state only moves for the six poll keys,
-- that a staff write through RLS still bumps (no extra grants needed), and who may read the
-- counters. SCRATCH DATABASE ONLY.
--
--   psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/data_versions_scenarios.sql
--
-- Ends with ALL_DATA_VERSION_SCENARIOS_PASSED.

\set QUIET on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['estimates','estimate_art_files','estimate_items','estimate_item_decorations',
    'sales_orders','so_art_files','so_firm_dates','so_items','so_item_decorations','so_item_pick_lines',
    'so_item_po_lines','so_jobs','invoices','invoice_payments','invoice_items','invoice_credit_memos',
    'messages','message_reads','assigned_todos','todo_comments','customers'] loop
    execute format('create table public.%I (id text primary key, v int)', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', t || '_all', t);
  end loop;
end $$;
create table public.app_state (id text primary key, value text);
alter table public.app_state enable row level security;
grant select, insert, update, delete on public.app_state to authenticated;
create policy app_state_all on public.app_state for all to authenticated using (true) with check (true);

\i supabase/migrations/20261014220000_data_versions.sql
\i supabase/migrations/20261014220000_data_versions.sql

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'SCENARIO FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create or replace function pg_temp.v() returns jsonb language sql as $$ select public.data_versions() $$;
-- Which counters moved between two snapshots.
create or replace function pg_temp.moved(a jsonb, b jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(a) k where a->k is distinct from b->k $$;

select pg_temp.expect((select count(*) from jsonb_object_keys(pg_temp.v())) = 6, 'six counters');

-- 1. Every write kind on every table moves exactly its own group (as the staff role, through RLS).
set role authenticated;
do $$
declare
  r record; before jsonb; after jsonb; m text; op text;
begin
  for r in select * from (values
    ('estimates','estimates'), ('estimate_art_files','estimates'), ('estimate_items','estimates'), ('estimate_item_decorations','estimates'),
    ('sales_orders','sales_orders'), ('so_art_files','sales_orders'), ('so_firm_dates','sales_orders'), ('so_items','sales_orders'),
    ('so_item_decorations','sales_orders'), ('so_item_pick_lines','sales_orders'), ('so_item_po_lines','sales_orders'), ('so_jobs','sales_orders'),
    ('invoices','invoices'), ('invoice_payments','invoices'), ('invoice_items','invoices'), ('invoice_credit_memos','invoices'),
    ('messages','messages'), ('message_reads','messages'), ('assigned_todos','assigned_todos'), ('todo_comments','assigned_todos')
  ) as t(tbl, grp) loop
    foreach op in array array['insert','update','delete'] loop
      before := public.data_versions();
      if op = 'insert' then execute format('insert into public.%I values (%L, 1)', r.tbl, 'x');
      elsif op = 'update' then execute format('update public.%I set v = v + 1 where id = %L', r.tbl, 'x');
      else execute format('delete from public.%I where id = %L', r.tbl, 'x'); end if;
      after := public.data_versions();
      m := pg_temp.moved(before, after);
      if m <> r.grp then raise exception 'SCENARIO FAILED: % on % moved [%], expected [%]', op, r.tbl, m, r.grp; end if;
    end loop;
  end loop;
  raise notice 'ok: insert/update/delete on all 20 tables move exactly their own group (as staff, through RLS)';
end $$;

-- 2. A write that touches no rows still counts (statement-level), and a table outside every group moves nothing.
do $$ declare b jsonb := public.data_versions(); begin
  update public.so_items set v = 0 where id = 'nope';
  if pg_temp.moved(b, public.data_versions()) <> 'sales_orders' then raise exception 'SCENARIO FAILED: 0-row update did not count'; end if;
  b := public.data_versions();
  insert into public.customers values ('c1', 1);
  if pg_temp.moved(b, public.data_versions()) <> '' then raise exception 'SCENARIO FAILED: customers write moved a counter'; end if;
  raise notice 'ok: a 0-row write counts; tables outside the groups move nothing';
end $$;

-- 3. app_state: only the six poll keys move its counter.
do $$ declare b jsonb; k text; begin
  foreach k in array array['inv_pos','inv_adj_log','inv_po_counter','submitted_batches','batch_pos','company_info'] loop
    b := public.data_versions(); insert into public.app_state values (k, '1');
    if pg_temp.moved(b, public.data_versions()) <> 'app_state' then raise exception 'SCENARIO FAILED: insert % did not move app_state', k; end if;
    b := public.data_versions(); update public.app_state set value = '2' where id = k;
    if pg_temp.moved(b, public.data_versions()) <> 'app_state' then raise exception 'SCENARIO FAILED: update % did not move app_state', k; end if;
    b := public.data_versions(); delete from public.app_state where id = k;
    if pg_temp.moved(b, public.data_versions()) <> 'app_state' then raise exception 'SCENARIO FAILED: delete % did not move app_state', k; end if;
  end loop;
  foreach k in array array['_pimg_p1','qbo_batch_1','_qb_link_v1_x','qb_config','so_history'] loop
    b := public.data_versions(); insert into public.app_state values (k, '1'); update public.app_state set value = '2' where id = k; delete from public.app_state where id = k;
    if pg_temp.moved(b, public.data_versions()) <> '' then raise exception 'SCENARIO FAILED: % moved a counter', k; end if;
  end loop;
  -- Renaming a key out of / into the watched set counts.
  insert into public.app_state values ('tmp', '1'); b := public.data_versions();
  update public.app_state set id = 'batch_pos' where id = 'tmp';
  if pg_temp.moved(b, public.data_versions()) <> 'app_state' then raise exception 'SCENARIO FAILED: rename into a poll key did not count'; end if;
  b := public.data_versions(); update public.app_state set id = 'tmp' where id = 'batch_pos';
  if pg_temp.moved(b, public.data_versions()) <> 'app_state' then raise exception 'SCENARIO FAILED: rename out of a poll key did not count'; end if;
  raise notice 'ok: app_state moves only for the six poll keys (insert/update/delete/rename), not for image, QuickBooks or history rows';
end $$;

-- 4. A rolled-back write still moves the counter (one harmless extra reload, never a missed one).
do $$ declare b jsonb := public.data_versions(); begin
  begin insert into public.so_items values ('rb', 1); raise exception 'rollback me'; exception when raise_exception then null; end;
  if pg_temp.moved(b, public.data_versions()) <> 'sales_orders' then raise exception 'SCENARIO FAILED: rolled-back write lost its bump'; end if;
  raise notice 'ok: a rolled-back write still moves the counter';
end $$;
reset role;

-- 5. Who can read the counters.
set role anon;
do $$ begin perform public.data_versions(); raise exception 'SCENARIO FAILED: anon read the counters';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the counters'; end $$;
do $$ begin perform nextval('public.data_version_sales_orders'); raise exception 'SCENARIO FAILED: anon bumped a counter directly';
exception when insufficient_privilege then raise notice 'ok: nobody bumps a counter directly'; end $$;
reset role;
select pg_temp.expect((select count(*) from pg_trigger where tgname like '%data_version%' and not tgisinternal) = 22, '22 triggers, none duplicated by the re-run');

\echo ALL_DATA_VERSION_SCENARIOS_PASSED
