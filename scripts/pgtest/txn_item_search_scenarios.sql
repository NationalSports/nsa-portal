-- Scenarios for migration 20261014210000_txn_item_search_stats.sql. Self-contained: builds an
-- archive with the shapes production has (matrix "PARENT : PARENT-SIZE" items, charge codes,
-- invoice-only codes, blanks), keeps the previous search_txn_items body as old_search_txn_items,
-- applies the migration, and checks the new search returns exactly what the old one did for a
-- spread of queries, that only staff get rows, and that a refresh picks up new imports.
-- SCRATCH DATABASE ONLY.
--
--   psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/txn_item_search_scenarios.sql
--
-- Ends with ALL_TXN_ITEM_SEARCH_SCENARIOS_PASSED.

\set QUIET on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth_uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- pg_cron stand-in: just enough for cron.schedule / cron.unschedule / cron.job.
create schema if not exists cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid::bigint $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  delete from cron.job where jobname = p_name returning true $$;

create table public.team_members (id text primary key, auth_id uuid, is_active boolean default true);
insert into public.team_members values ('tm-rep', '11111111-1111-1111-1111-111111111111', true);
create function public.is_team_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = (select auth.uid()) and coalesce(tm.is_active, true)) $$;

create table public.products (id text primary key, sku text unique);
insert into public.products values ('p1', 'HT3973'), ('p2', 'ST350');

create table public.customer_invoice_lines (
  id bigserial primary key, netsuite_internal_id text, line_seq int, transaction_type text,
  transaction_date date, item text, quantity numeric, amount numeric);
alter table public.customer_invoice_lines enable row level security;
grant select on public.customer_invoice_lines to authenticated;
create policy customer_invoice_lines_staff_all on public.customer_invoice_lines for all to authenticated
  using ((select public.is_team_member())) with check ((select public.is_team_member()));

-- Production normalizers (20260811163845).
create function public.txn_item_code(p_item text) returns text language sql immutable as $$
  select nullif(btrim(split_part(coalesce(p_item, ''), ' : ', 1)), '') $$;
create function public.txn_item_is_service(p_code text) returns boolean language sql immutable as $$
  select coalesce(btrim(coalesce(p_code, '')) = '' or lower(btrim(p_code)) ~ ('^[^a-z0-9]*(' ||
    'shipping|freight|misc|deco|decals|digi|numbers|names|patch|twill|vector|ghost|' ||
    'screen|credit|promo|ob|opening|rush|sample|setup|set|rerun|art|color|colour|' ||
    'emb|embroidery|heat|transfer|size|inv|tbd|no use|not|discount|tax|labor|service' ||
    ')([ ._/-]|$)'), true) $$;

-- The search as it was before the migration, kept for comparison.
create function public.old_search_txn_items(p_query text, p_limit int default 20)
returns table(item text, txn_count int, line_count int, total_qty numeric, total_amount numeric, first_date date, last_date date, in_catalog boolean)
language sql stable as $$
  with q as (select lower(btrim(coalesce(p_query, ''))) as t),
  hits as (
    select txn_item_code(l.item) as item, count(distinct l.netsuite_internal_id)::int as txn_count, count(*)::int as line_count,
           sum(coalesce(l.quantity, 0)) as total_qty, sum(coalesce(l.amount, 0)) as total_amount,
           min(l.transaction_date) as first_date, max(l.transaction_date) as last_date
      from customer_invoice_lines l cross join q
     where q.t <> '' and txn_item_code(l.item) is not null and not txn_item_is_service(txn_item_code(l.item))
       and lower(txn_item_code(l.item)) like '%' || q.t || '%'
     group by txn_item_code(l.item)
    having count(*) filter (where l.transaction_type = 'sales_order') > 0)
  select h.item, h.txn_count, h.line_count, h.total_qty, h.total_amount, h.first_date, h.last_date,
         exists (select 1 from products p where p.sku = h.item) as in_catalog
    from hits h cross join q
   order by case when lower(h.item) = q.t then 0 when lower(h.item) like q.t || '%' then 1 else 2 end, h.txn_count desc, h.item
   limit least(greatest(coalesce(p_limit, 20), 1), 100) $$;

-- ── Archive: 6,000 lines across matrix garments, plain SKUs, charges, invoice-only codes, blanks ──
insert into public.customer_invoice_lines (netsuite_internal_id, line_seq, transaction_type, transaction_date, item, quantity, amount)
select 'T' || (g % 900), g,
       case when g % 7 = 0 then 'invoice' else 'sales_order' end,
       date '2021-01-01' + (g % 1700),
       case g % 13
         when 0 then 'HT3973 : HT3973-' || (array['S','M','L','XL'])[1 + g % 4]
         when 1 then 'ST350'
         when 2 then 'Shipping'
         when 3 then 'Emb-NSA'
         when 4 then 'Screen : Screen 2'
         when 5 then '3S-POLO-' || (g % 5)
         when 6 then 'Polo 3S Tee'
         when 7 then '  JH-' || (g % 40) || '  '
         when 8 then null
         when 9 then 'SETUP123'
         when 10 then 'Misc Sanmar'
         when 11 then 'covert-' || (g % 3)
         else 'TEE-' || (g % 60) || ' : TEE-' || (g % 60) || '-L'
       end,
       (g % 12) + 1, ((g % 97) + 1) * 3.25
  from generate_series(1, 6000) g;
-- An invoice-only code (no sales_order line): must never appear.
insert into public.customer_invoice_lines (netsuite_internal_id, line_seq, transaction_type, transaction_date, item, quantity, amount)
values ('T-INV', 1, 'invoice', '2024-02-02', 'Opening Balance Item AR', 1, 10), ('T-INV', 2, 'invoice', '2024-02-02', 'ZZONLYINV', 1, 10);

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'SCENARIO FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

-- ── Apply the migration (twice: re-running must be harmless) ──
\i supabase/migrations/20261014210000_txn_item_search_stats.sql
\i supabase/migrations/20261014210000_txn_item_search_stats.sql

-- 1. Same answers as before, for a spread of queries (exact, prefix, substring, case, padding,
--    service words, a size suffix, and nothing).
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
do $$
declare q text; lim int; old_r text; new_r text; n int;
begin
  foreach q in array array['ht3973','HT3973',' ht39 ','3s','polo','jh','jh-1','tee','tee-1','st350','setup','covert','ship','misc','screen','emb','-l','zzonlyinv','opening','nomatch','a','e',''] loop
    foreach lim in array array[1, 5, 20, 100] loop
      select string_agg(row(o.*)::text, '|') into old_r from public.old_search_txn_items(q, lim) o;
      select string_agg(row(s.*)::text, '|'), count(*) into new_r, n from public.search_txn_items(q, lim) s;
      if old_r is distinct from new_r then
        raise exception 'SCENARIO FAILED: % (limit %) differs: old=% new=%', q, lim, left(old_r, 300), left(new_r, 300);
      end if;
    end loop;
  end loop;
  raise notice 'ok: new search matches the old search on 23 queries x 4 limits';
end $$;
select pg_temp.expect((select count(*) from public.search_txn_items('3s', 100)) > 1, 'fixture is not vacuous: "3s" finds several items');
select pg_temp.expect(not exists (select 1 from public.search_txn_items('ship', 100)), 'charge codes stay out');
select pg_temp.expect(not exists (select 1 from public.search_txn_items('zzonlyinv', 100)), 'invoice-only codes stay out');
select pg_temp.expect((select in_catalog from public.search_txn_items('ht3973', 1)), 'in_catalog still computed live');

-- 2. Only staff get rows; nobody else can read the summary directly.
set role authenticated;
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.expect((select count(*) from public.search_txn_items('tee', 100)) > 0, 'signed-in staff can search');
select set_config('test.auth_uid', '99999999-9999-9999-9999-999999999999', false);
select pg_temp.expect((select count(*) from public.search_txn_items('tee', 100)) = 0, 'a signed-in non-staff user (coach) gets nothing');
do $$ begin perform 1 from public.txn_item_search_stats; raise exception 'SCENARIO FAILED: authenticated read the summary view';
exception when insufficient_privilege then raise notice 'ok: authenticated cannot read the summary view directly'; end $$;
reset role;
set role anon;
do $$ begin perform public.search_txn_items('tee', 5); raise exception 'SCENARIO FAILED: anon ran the search';
exception when insufficient_privilege then raise notice 'ok: anon cannot run the search'; end $$;
do $$ begin perform 1 from public.txn_item_search_stats; raise exception 'SCENARIO FAILED: anon read the summary view';
exception when insufficient_privilege then raise notice 'ok: anon cannot read the summary view'; end $$;
reset role;

-- 3. Freshness: a new import shows up after a refresh (what the nightly job and the import script run).
insert into public.customer_invoice_lines (netsuite_internal_id, line_seq, transaction_type, transaction_date, item, quantity, amount)
values ('T-NEW', 1, 'sales_order', '2026-10-14', 'NEWSKU9 : NEWSKU9-M', 3, 30);
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.expect(not exists (select 1 from public.search_txn_items('newsku9', 5)), 'before refresh the new item is not listed yet');
refresh materialized view concurrently public.txn_item_search_stats;
select pg_temp.expect((select item from public.search_txn_items('newsku9', 5)) = 'NEWSKU9', 'after refresh the new item is listed');
select pg_temp.expect((select string_agg(row(o.*)::text, '|') from public.old_search_txn_items('new', 100) o)
  = (select string_agg(row(s.*)::text, '|') from public.search_txn_items('new', 100) s), 'still identical to the old search after the refresh');

-- 4. Exactly one nightly refresh job.
select pg_temp.expect((select count(*) from cron.job where jobname = 'refresh_txn_item_search_stats') = 1
  and (select command from cron.job where jobname = 'refresh_txn_item_search_stats') like 'refresh materialized view concurrently public.txn_item_search_stats%',
  'one nightly refresh job registered');

\echo ALL_TXN_ITEM_SEARCH_SCENARIOS_PASSED
