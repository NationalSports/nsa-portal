-- Scenarios for migration 20261013110000_rls_staff_check_once_per_query.sql. Self-contained: builds
-- tables carrying every shape of helper-calling policy production has (pg_policies, 2026-10-13),
-- records what each kind of caller can read, insert and update, applies the migration, and checks
-- that (1) every answer is identical, (2) the check now runs once per query, (3) policies that were
-- already wrapped or never called a helper are untouched, (4) re-running is a no-op.
-- SCRATCH DATABASE ONLY.
--
--   psql -h /tmp/pgtest -p 54999 -U postgres -v ON_ERROR_STOP=1 -f scripts/pgtest/rls_check_once_scenarios.sql
--
-- Ends with ALL_RLS_CHECK_ONCE_SCENARIOS_PASSED.

\set QUIET on
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth_uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- ── Identity tables and production's helper bodies ──
create table public.team_members (id text primary key, role text, auth_id uuid, is_active boolean default true);
create table public.user_profiles (auth_id uuid primary key, role text);

create or replace function public.is_team_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = (select auth.uid()) and coalesce(tm.is_active, true)) $$;
create or replace function public.is_admin_member() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false and tm.role in ('admin','super_admin')) $$;
create or replace function public.is_quickbooks_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false and tm.role in ('admin','super_admin','accounting')) $$;
create or replace function public.is_admin_or_gm() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.user_profiles where auth_id = auth.uid() and role in ('admin','gm')) $$;
create or replace function public.current_user_role() returns text language sql stable security definer set search_path = public, pg_catalog as $$
  select role from public.user_profiles where auth_id = auth.uid() limit 1 $$;

-- ── One table per production policy shape ──
create table public.message_reads (id text primary key);           -- staff-only FOR ALL (qual + check)
create table public.so_items (id text primary key);                -- public `true` read + staff FOR ALL
create table public.batch_allocations (id text primary key);       -- staff SELECT (qual only)
create table public.auto_po_settings (id text primary key);        -- staff INSERT (check only)
create table public.app_state (id text primary key, value text);   -- the admin / QuickBooks carve-outs
create table public.workspace_items (id text primary key, visibility text, created_by text);
create table public.shipment_notices (id text primary key);        -- COALESCE(is_team_member(), false)
create table public.bot_heartbeats (id text primary key);          -- is_admin_or_gm() OR current_user_role() = ANY
create table public.product_variants (id text primary key);        -- is_admin_or_gm() + public read
create table public.notes (id text primary key);                   -- no helper at all: must stay untouched

do $$ declare t text; begin
  foreach t in array array['team_members','user_profiles','message_reads','so_items','batch_allocations','auto_po_settings',
    'app_state','workspace_items','shipment_notices','bot_heartbeats','product_variants','notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

create policy message_reads_staff_all on public.message_reads for all to authenticated using (is_team_member()) with check (is_team_member());
create policy so_items_read on public.so_items for select to anon, authenticated using (true);
create policy so_items_staff_write on public.so_items for all to authenticated using (is_team_member()) with check (is_team_member());
create policy batch_allocations_staff_read on public.batch_allocations for select to authenticated using (is_team_member());
create policy auto_po_settings_staff_read on public.auto_po_settings for select to authenticated using (is_team_member());
create policy auto_po_settings_staff_insert on public.auto_po_settings for insert to authenticated with check (is_team_member());
create policy app_state_read on public.app_state for select to anon, authenticated using (
  ((id <> 'comm_rep_comp') and (id <> 'qb_config') and (left(id, 4) <> '_qb_'))
  or ((id = 'comm_rep_comp') and is_admin_member())
  or (((id = 'qb_config') or (left(id, 4) = '_qb_')) and is_quickbooks_member()));
create policy app_state_staff_write on public.app_state for all to authenticated
  using (is_team_member() and ((id <> 'comm_rep_comp') or is_admin_member()) and (((id <> 'qb_config') and (left(id, 4) <> '_qb_')) or is_quickbooks_member()))
  with check (is_team_member() and ((id <> 'comm_rep_comp') or is_admin_member()) and (((id <> 'qb_config') and (left(id, 4) <> '_qb_')) or is_quickbooks_member()));
create policy workspace_items_staff_read on public.workspace_items for select to authenticated using (
  is_team_member() and ((visibility = 'team') or (created_by = (select tm.id from team_members tm where tm.auth_id = (select auth.uid()) and tm.is_active is not false limit 1))));
create policy workspace_items_staff_insert on public.workspace_items for insert to authenticated with check (
  is_team_member() and (created_by = (select tm.id from team_members tm where tm.auth_id = (select auth.uid()) and tm.is_active is not false limit 1)));
create policy workspace_items_staff_update on public.workspace_items for update to authenticated
  using (is_team_member() and (created_by = (select tm.id from team_members tm where tm.auth_id = (select auth.uid()) and tm.is_active is not false limit 1)))
  with check (is_team_member() and (created_by = (select tm.id from team_members tm where tm.auth_id = (select auth.uid()) and tm.is_active is not false limit 1)));
create policy shipment_notices_staff_read on public.shipment_notices for select to authenticated using (coalesce(is_team_member(), false));
create policy bot_heartbeats_select on public.bot_heartbeats for select to anon, authenticated using (true);
create policy bot_heartbeats_write on public.bot_heartbeats for all to authenticated
  using (is_admin_or_gm() or (current_user_role() = any (array['rep','csr','warehouse'])));
create policy variants_select on public.product_variants for select to anon, authenticated using (true);
create policy variants_admin_all on public.product_variants for all to authenticated using (is_admin_or_gm());
-- Already in the fast form: must come out byte-for-byte the same.
create policy profiles_select_own_or_staff on public.user_profiles for select to authenticated
  using ((auth_id = (select auth.uid())) or (select is_team_member()));
create policy profiles_admin_all on public.user_profiles for all to authenticated using (is_admin_or_gm());
create policy team_members_staff_read on public.team_members for select to authenticated using (is_team_member());
create policy notes_read on public.notes for select to anon, authenticated using (id <> 'hidden');

-- ── Seed: one caller of each kind ──
insert into public.team_members values
  ('tm-rep','rep','11111111-1111-1111-1111-111111111111',true),
  ('tm-admin','admin','22222222-2222-2222-2222-222222222222',true),
  ('tm-acct','accounting','33333333-3333-3333-3333-333333333333',true),
  ('tm-gone','rep','44444444-4444-4444-4444-444444444444',false);
insert into public.user_profiles values
  ('11111111-1111-1111-1111-111111111111','rep'), ('22222222-2222-2222-2222-222222222222','admin'),
  ('33333333-3333-3333-3333-333333333333','csr'), ('44444444-4444-4444-4444-444444444444','warehouse'),
  ('55555555-5555-5555-5555-555555555555','gm');
insert into public.message_reads values ('m1'), ('m2');
insert into public.so_items values ('i1'), ('i2');
insert into public.batch_allocations values ('b1');
insert into public.auto_po_settings values ('a1');
insert into public.app_state values ('company_info','{}'), ('comm_rep_comp','{}'), ('qb_config','{}'), ('_qb_token','{}');
insert into public.workspace_items values ('w-team','team','tm-admin'), ('w-mine','private','tm-rep'), ('w-theirs','private','tm-admin');
insert into public.shipment_notices values ('n1');
insert into public.bot_heartbeats values ('h1');
insert into public.product_variants values ('v1');
insert into public.notes values ('shown'), ('hidden');

create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'SCENARIO FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create or replace function pg_temp.explain_lines(q text) returns setof text language plpgsql as $$
declare l text; begin for l in execute 'explain (costs off) ' || q loop return next l; end loop; end $$;

-- What every caller can read, insert and update, table by table. Each probe runs as that caller
-- and is rolled back, so the data never changes between snapshots.
create table pg_temp.access (phase text, persona text, tbl text, probe text, result text);
create or replace function pg_temp.snapshot(p_phase text) returns void language plpgsql as $$
declare
  per record; t text; probe_id text; res text; n int;
  tables text[] := array['team_members','user_profiles','message_reads','so_items','batch_allocations','auto_po_settings',
    'app_state','workspace_items','shipment_notices','bot_heartbeats','product_variants','notes'];
begin
  for per in select * from (values ('anon','anon',''), ('coach','authenticated','99999999-9999-9999-9999-999999999999'),
      ('rep','authenticated','11111111-1111-1111-1111-111111111111'), ('admin','authenticated','22222222-2222-2222-2222-222222222222'),
      ('accounting','authenticated','33333333-3333-3333-3333-333333333333'), ('deactivated','authenticated','44444444-4444-4444-4444-444444444444'),
      ('gm','authenticated','55555555-5555-5555-5555-555555555555')) as p(name, pgrole, uid) loop
    foreach t in array tables loop
      perform set_config('test.auth_uid', per.uid, true);
      perform set_config('role', per.pgrole, true);
      execute format('select coalesce(string_agg(x::text, %L order by x::text), %L) from (select to_jsonb(r) x from public.%I r) s', ',', '-', t) into res;
      perform set_config('role', 'postgres', true);
      insert into pg_temp.access values (p_phase, per.name, t, 'read', res);
      -- insert probes: an ordinary row, plus the app_state carve-out keys and a workspace row "as me"
      foreach probe_id in array case t when 'app_state' then array['probe','_qb_probe'] else array['probe'] end loop
        perform set_config('role', per.pgrole, true);
        begin
          if t = 'workspace_items' then
            execute format('insert into public.%I (id, visibility, created_by) values (%L, %L, %L)', t, probe_id, 'private', 'tm-rep');
          elsif t in ('team_members','user_profiles') then
            execute format('insert into public.%I (%s) values (%L)', t, case t when 'team_members' then 'id' else 'auth_id' end,
                           case t when 'team_members' then probe_id else '00000000-0000-0000-0000-000000000000' end);
          else
            execute format('insert into public.%I (id) values (%L)', t, probe_id);
          end if;
          raise exception using errcode = 'P0001', message = 'probe_ok';
        exception when others then res := case when sqlerrm = 'probe_ok' then 'allowed' else 'refused' end;
        end;
        perform set_config('role', 'postgres', true);
        insert into pg_temp.access values (p_phase, per.name, t, 'insert ' || probe_id, res);
      end loop;
      -- update probe: how many rows this caller may touch (no-op SET, rolled back regardless)
      perform set_config('role', per.pgrole, true);
      begin
        execute format('update public.%I set %I = %I', t, case t when 'user_profiles' then 'auth_id' else 'id' end, case t when 'user_profiles' then 'auth_id' else 'id' end);
        get diagnostics n = row_count;
        res := n::text;
        raise exception using errcode = 'P0001', message = 'probe_ok';
      exception when others then if sqlerrm <> 'probe_ok' then res := 'refused'; end if;
      end;
      perform set_config('role', 'postgres', true);
      insert into pg_temp.access values (p_phase, per.name, t, 'update', res);
    end loop;
  end loop;
end $$;

-- Sanity: the fixture exercises the carve-outs (otherwise "identical" proves little).
select pg_temp.snapshot('before');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='rep' and tbl='app_state' and probe='read') not like '%qb_config%', 'fixture: a rep cannot read qb_config');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='accounting' and tbl='app_state' and probe='read') like '%qb_config%', 'fixture: accounting reads qb_config');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='admin' and tbl='app_state' and probe='read') like '%comm_rep_comp%', 'fixture: admin reads comm_rep_comp');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='rep' and tbl='app_state' and probe='insert _qb_probe') = 'refused', 'fixture: a rep cannot write a _qb_ key');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='deactivated' and tbl='message_reads' and probe='read') = '-', 'fixture: deactivated staff read nothing');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='rep' and tbl='workspace_items' and probe='read') not like '%w-theirs%', 'fixture: a rep cannot read someone else''s private workspace item');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='deactivated' and tbl='bot_heartbeats' and probe='update') = '1', 'fixture: current_user_role() branch grants a warehouse profile');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='gm' and tbl='product_variants' and probe='insert probe') = 'allowed', 'fixture: is_admin_or_gm() grants a gm');
select pg_temp.expect((select result from pg_temp.access where phase='before' and persona='coach' and tbl='message_reads' and probe='insert probe') = 'refused', 'fixture: a non-staff caller cannot write');

create table pg_temp.policies_before as select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public';

-- Before: a staff read checks membership on every row.
set role authenticated;
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
create temporary table plan_before as select string_agg(l, E'\n') as plan from (select * from pg_temp.explain_lines('select id from public.message_reads')) x(l);
reset role;

-- ── Apply the migration ──
\i supabase/migrations/20261013110000_rls_staff_check_once_per_query.sql

-- 1. Identical access for every caller, table and probe.
select pg_temp.snapshot('after');
select pg_temp.expect(not exists (
  select persona, tbl, probe, result from pg_temp.access where phase = 'before'
  except select persona, tbl, probe, result from pg_temp.access where phase = 'after'
  union all
  select persona, tbl, probe, result from pg_temp.access where phase = 'after'
  except select persona, tbl, probe, result from pg_temp.access where phase = 'before'),
  'every caller reads, inserts and updates exactly what they did before (' || (select count(*) from pg_temp.access where phase = 'after') || ' probes)');

-- 2. The check now runs once per query.
select pg_temp.expect((select count(*) from pg_policies where schemaname = 'public'
  and (coalesce(qual,'') || coalesce(with_check,'')) ~ '(?<!SELECT )\m(is_team_member|is_admin_member|is_quickbooks_member|is_admin_or_gm|current_user_role)\(\)') = 0,
  'no bare helper call left in any policy');
set role authenticated;
select pg_temp.expect((select string_agg(l, E'\n') from pg_temp.explain_lines('select id from public.message_reads') x(l)) ~ 'InitPlan'
  and (select plan from plan_before) !~ 'InitPlan', 'staff read of message_reads: per-row Filter before, one InitPlan after');
reset role;

-- 3. Untouched: policies already in the fast form, policies with no helper, and every name/command/role.
select pg_temp.expect((select qual from pg_policies where policyname = 'profiles_select_own_or_staff')
  = (select qual from pg_temp.policies_before where policyname = 'profiles_select_own_or_staff'), 'already-wrapped policy unchanged');
select pg_temp.expect((select qual from pg_policies where policyname = 'notes_read')
  = (select qual from pg_temp.policies_before where policyname = 'notes_read'), 'policy without helpers unchanged');
select pg_temp.expect(not exists (select tablename, policyname, cmd, roles from pg_temp.policies_before
  except select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public')
  and (select count(*) from pg_policies where schemaname = 'public') = (select count(*) from pg_temp.policies_before),
  'same policies, commands and roles');

-- 4. Re-running is a no-op.
create temporary table policies_after as select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public';
\i supabase/migrations/20261013110000_rls_staff_check_once_per_query.sql
select pg_temp.expect(not exists (select * from policies_after except select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'),
  're-running the migration changes nothing');

-- 5. And it is faster: 50k rows read as staff through a staff-only policy, bare vs wrapped.
create table public.big (id int primary key);
insert into public.big select generate_series(1, 50000);
alter table public.big enable row level security;
grant select on public.big to authenticated;
create policy big_bare on public.big for select to authenticated using (is_team_member());
analyze public.big;
create or replace function pg_temp.time_staff_scan() returns numeric language plpgsql as $$
declare t0 timestamptz; n int;
begin
  perform set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('role', 'authenticated', true);
  t0 := clock_timestamp();
  select count(*) into n from public.big;
  perform set_config('role', 'postgres', true);
  if n <> 50000 then raise exception 'SCENARIO FAILED: staff saw % of 50000 rows', n; end if;
  return extract(epoch from clock_timestamp() - t0) * 1000;
end $$;
create temporary table timing as select pg_temp.time_staff_scan() as bare_ms;
\i supabase/migrations/20261013110000_rls_staff_check_once_per_query.sql
alter table timing add column wrapped_ms numeric;
update timing set wrapped_ms = pg_temp.time_staff_scan();
select format('50k-row staff read: %s ms bare, %s ms wrapped', round(bare_ms, 1), round(wrapped_ms, 1)) as timing from timing;
select pg_temp.expect((select wrapped_ms * 5 < bare_ms from timing), 'wrapped staff read is at least 5x faster');

\echo ALL_RLS_CHECK_ONCE_SCENARIOS_PASSED
