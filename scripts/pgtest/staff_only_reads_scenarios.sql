-- Scenarios for migration 20261013120000_staff_only_business_reads.sql. Self-contained: builds the
-- 35 tables with their production read/write policies (pg_policies, 2026-10-13), applies the
-- migration, and checks what each kind of caller can read afterwards. SCRATCH DATABASE ONLY.
--
--   psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/staff_only_reads_scenarios.sql
--
-- Ends with ALL_STAFF_ONLY_READ_SCENARIOS_PASSED.

\set QUIET on
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth_uid', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- ── Tables: every one of the 35 gets id + customer_id (enough to read), RLS, Supabase's default
-- grants, and its production policy pair: `<t>_read` / `<t>_anon_read` + `<t>_staff_write`. ──
create table public.team_members (id text primary key, name text, email text, role text, phone text, auth_id uuid,
  is_active boolean default true, commission_rate numeric);
create table public.customers (id text primary key, name text, parent_id text, school_colors jsonb, alpha_tag text);
create table public.coach_accounts (id serial primary key, email text, customer_id text, status text default 'active', auth_user_id uuid);
create table public.app_state (id text primary key, value text);
create table public.vendors (id text primary key, name text, api_provider text, b2b_password text);
create table public.products (id text primary key, vendor_id text, sku text, name text, brand text, color text,
  color_category text, category text, retail_price numeric, nsa_cost numeric, is_active boolean default true,
  is_archived boolean, available_sizes jsonb, _colors jsonb, image_front_url text, image_back_url text,
  pricing_group text, inventory_source text, created_at timestamptz default now(), updated_at timestamptz default now(),
  is_clearance boolean, clearance_cost numeric);
create table public.product_inventory (id serial primary key, product_id text, size text, quantity int);

do $$
declare t text;
begin
  foreach t in array array['sales_orders','so_items','so_item_decorations','so_item_po_lines','so_item_pick_lines',
    'so_jobs','so_art_files','so_firm_dates','estimates','estimate_items','estimate_item_decorations',
    'estimate_art_files','invoices','invoice_items','invoice_payments','customer_contacts',
    'customer_credits','customer_credit_usage','customer_promo_programs','customer_promo_periods',
    'customer_promo_usage','deco_vendors','deco_vendor_pricing','assigned_todos','todo_comments',
    'dismissed_todos','dismissed_notifs','issues','rep_csr_assignments','omg_stores','omg_store_products'] loop
    execute format('create table public.%I (id text primary key, customer_id text)', t);
  end loop;
end $$;

create or replace function public.is_team_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = (select auth.uid()) and coalesce(tm.is_active, true)) $$;
create or replace function public.is_admin_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false and tm.role in ('admin','super_admin')) $$;
create or replace function public.is_quickbooks_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false and tm.role in ('admin','super_admin','accounting')) $$;

do $$
declare t text; anon_only text[] := array['vendors','deco_vendors','deco_vendor_pricing','assigned_todos','todo_comments',
  'dismissed_todos','dismissed_notifs','issues','rep_csr_assignments','omg_stores','omg_store_products'];
begin
  foreach t in array array['sales_orders','so_items','so_item_decorations','so_item_po_lines','so_item_pick_lines',
    'so_jobs','so_art_files','so_firm_dates','estimates','estimate_items','estimate_item_decorations',
    'estimate_art_files','invoices','invoice_items','invoice_payments','customers','customer_contacts',
    'customer_credits','customer_credit_usage','customer_promo_programs','customer_promo_periods',
    'customer_promo_usage','team_members','vendors','deco_vendors','deco_vendor_pricing','assigned_todos','todo_comments',
    'dismissed_todos','dismissed_notifs','issues','rep_csr_assignments','omg_stores','omg_store_products'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', t);
    if t = any(anon_only) then
      execute format('create policy %I on public.%I for select to anon using (true)', t || '_anon_read', t);
    else
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    end if;
    execute format('create policy %I on public.%I for all to authenticated using (is_team_member()) with check (is_team_member())', t || '_staff_write', t);
  end loop;
end $$;

alter table public.app_state enable row level security;
grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
create policy app_state_read on public.app_state for select to anon, authenticated using (
  ((id <> 'comm_rep_comp') and (id <> 'qb_config') and (left(id, 4) <> '_qb_'))
  or ((id = 'comm_rep_comp') and is_admin_member())
  or (((id = 'qb_config') or (left(id, 4) = '_qb_')) and is_quickbooks_member()));
create policy app_state_staff_write on public.app_state for all to authenticated
  using (is_team_member() and ((id <> 'comm_rep_comp') or is_admin_member()) and (((id <> 'qb_config') and (left(id, 4) <> '_qb_')) or is_quickbooks_member()))
  with check (is_team_member() and ((id <> 'comm_rep_comp') or is_admin_member()) and (((id <> 'qb_config') and (left(id, 4) <> '_qb_')) or is_quickbooks_member()));

alter table public.coach_accounts enable row level security;
grant select on public.coach_accounts to authenticated;
create policy coach_accounts_self_read on public.coach_accounts for select to authenticated using (
  (auth_user_id = (select auth.uid())) or (lower(email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))));

alter table public.products enable row level security;
alter table public.product_inventory enable row level security;
grant select on public.products, public.product_inventory to anon, authenticated;
create policy products_anon_read on public.products for select to anon using (true);
create policy product_inventory_anon_read on public.product_inventory for select to anon using (true);

-- search_products: production's body, reduced to the parts that read vendors / products.
create or replace function public.search_products(p_query text, p_category text, p_vendor_id text, p_color_category text, p_in_stock boolean, p_limit integer, p_offset integer)
returns table(id text, vendor_id text, sku text, name text) language plpgsql set search_path to 'public', 'pg_catalog' as $$
begin
  return query select pr.id, pr.vendor_id, pr.sku, pr.name from products pr
   where (p_query is null or pr.name ilike '%' || p_query || '%') and (pr.is_archived is not true)
     and not exists (select 1 from vendors ve where ve.id = pr.vendor_id and ve.api_provider in ('sanmar','ss_activewear','momentec','richardson'))
   order by pr.name limit p_limit offset p_offset;
end $$;
grant execute on function public.search_products(text,text,text,text,boolean,integer,integer) to anon, authenticated;

-- ── Seed ──
insert into public.team_members values
  ('tm-rep','Rep','rep@nsa.test','rep','555','11111111-1111-1111-1111-111111111111',true,0.1),
  ('tm-acct','Accountant','acct@nsa.test','accounting','556','22222222-2222-2222-2222-222222222222',true,0),
  ('tm-gone','Former','gone@nsa.test','rep','557','33333333-3333-3333-3333-333333333333',false,0.2);
insert into public.customers values ('c-dept','Dept',null,'["navy"]','DEPT'), ('c-fb','Football','c-dept',null,'FB'), ('c-other','Other',null,null,'OTH');
insert into public.coach_accounts (email, customer_id, status) values ('coach@school.test','c-fb','active'), ('old@school.test','c-other','disabled');
insert into public.sales_orders values ('SO-1','c-fb'), ('SO-2','c-other');
insert into public.vendors values ('v-ss','S&S','ss_activewear','x'), ('v-local','Local',null,'hunter2');
insert into public.products (id, vendor_id, sku, name) values ('p-ss','v-ss','SS1','Api Tee'), ('p-local','v-local','LOC1','Local Tee');
insert into public.app_state values ('company_info','{}'), ('qb_config','{"token":"x"}');

-- ── Apply the migration ──
\i supabase/migrations/20261013120000_staff_only_business_reads.sql

-- Re-running is harmless (drop if exists / create or replace).
\i supabase/migrations/20261013120000_staff_only_business_reads.sql

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'SCENARIO FAILED: %', what; end if; raise notice 'ok: %', what; end $$;

-- 1. Anonymous visitor: private tables refuse outright; the login roster and catalog search work.
set role anon;
select set_config('test.auth_uid', '', false), set_config('test.jwt', '', false);
do $$ begin perform 1 from public.sales_orders; raise exception 'SCENARIO FAILED: anon read sales_orders';
exception when insufficient_privilege then raise notice 'ok: anon sales_orders -> permission denied'; end $$;
do $$ begin perform 1 from public.team_members; raise exception 'SCENARIO FAILED: anon read team_members';
exception when insufficient_privilege then raise notice 'ok: anon team_members -> permission denied'; end $$;
do $$ begin perform 1 from public.vendors; raise exception 'SCENARIO FAILED: anon read vendors';
exception when insufficient_privilege then raise notice 'ok: anon vendors -> permission denied'; end $$;
select pg_temp.expect((select count(*) from public.login_roster()) = 2, 'anon login roster lists the 2 active staff');
select pg_temp.expect((select array_agg(id order by id) from public.search_products(null,null,null,null,false,50,0)) = array['p-local'],
  'anon catalog search still hides API-vendor products (reads vendors as owner)');
select pg_temp.expect((select count(*) from public.products) = 2, 'anon still reads the catalog');
reset role;
select pg_temp.expect(
  (select pg_get_function_result('public.login_roster()'::regprocedure)) = 'TABLE(id text, name text, role text, email text, is_active boolean)',
  'login roster returns id/name/role/email/is_active only (no phone, auth id, commission)');

-- 2. Signed-in coach: their own team and its parent, nothing else.
set role authenticated;
select set_config('test.auth_uid', '99999999-9999-9999-9999-999999999999', false), set_config('test.jwt', '{"email":"Coach@School.test"}', false);
select pg_temp.expect((select array_agg(id order by id) from public.customers) = array['c-dept','c-fb'], 'coach reads own team + parent only');
select pg_temp.expect((select count(*) from public.sales_orders) = 0, 'coach reads no orders');
select pg_temp.expect((select count(*) from public.team_members) = 0, 'coach reads no staff');
select pg_temp.expect((select count(*) from public.vendors) = 0, 'coach reads no vendors');
select pg_temp.expect((select array_agg(id order by id) from public.search_products(null,null,null,null,false,50,0)) = array['p-local'], 'coach catalog search unchanged');
-- A disabled coach account reads nothing.
select set_config('test.jwt', '{"email":"old@school.test"}', false);
select pg_temp.expect((select count(*) from public.customers) = 0, 'disabled coach reads no customers');

-- 3. Staff: everything, with the existing QuickBooks / admin carve-outs on app_state.
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false), set_config('test.jwt', '{"email":"rep@nsa.test"}', false);
select pg_temp.expect((select count(*) from public.sales_orders) = 2, 'staff read every order');
select pg_temp.expect((select count(*) from public.customers) = 3, 'staff read every customer');
select pg_temp.expect((select count(*) from public.vendors) = 2, 'staff read vendors');
select pg_temp.expect((select array_agg(id) from public.app_state) = array['company_info'], 'non-accounting staff still cannot read qb_config');
select set_config('test.auth_uid', '22222222-2222-2222-2222-222222222222', false);
select pg_temp.expect((select count(*) from public.app_state) = 2, 'accounting staff still read qb_config');

-- 4. Deactivated staff: nothing.
select set_config('test.auth_uid', '33333333-3333-3333-3333-333333333333', false);
select pg_temp.expect((select count(*) from public.sales_orders) = 0, 'deactivated staff read no orders');
select pg_temp.expect((select count(*) from public.customers) = 0, 'deactivated staff read no customers');
reset role;

-- 5. The end-state assertion is real: with a stray public read policy left on a table, applying
-- the migration fails and rolls back (anon keeps the SELECT grant the migration would revoke).
create policy sneaky_read on public.sales_orders for select to anon using (true);
grant select on public.sales_orders to anon;
\set ON_ERROR_STOP 0
\echo -- expected failure: staff-only reads: sales_orders still has a public or unconditional read policy
\i supabase/migrations/20261013120000_staff_only_business_reads.sql
\set ON_ERROR_STOP 1
select pg_temp.expect(has_table_privilege('anon', 'public.sales_orders', 'SELECT'), 'migration aborted and rolled back on a leftover public policy');
drop policy sneaky_read on public.sales_orders;
revoke select on public.sales_orders from anon;

\echo ALL_STAFF_ONLY_READ_SCENARIOS_PASSED
