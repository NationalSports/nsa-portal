-- Scratch-DB fixture for migration 00173 (RLS step 1). Stubs Supabase's auth.uid() so the policies
-- can be exercised under real role switches (anon / authenticated-staff / authenticated-coach).
-- Never run against a real database — this CREATEs its own roles and tables.

create extension if not exists pgcrypto;

-- Supabase roles
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;

-- Stub auth.uid(): reads a per-session GUC we set in the scenarios to simulate "who is logged in".
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.auth_uid', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Target tables (minimal shape matching production)
create table public.team_members (
  id text primary key, name text, email text, role text,
  auth_id uuid, is_active boolean default true
);
create table public.app_state (id text primary key, value text, updated_at timestamptz default now());
create table public.scheduled_emails (id uuid primary key default gen_random_uuid(), send_at timestamptz, payload jsonb);

grant select, insert, update, delete on public.team_members to anon, authenticated, service_role;
grant select, insert, update, delete on public.app_state to anon, authenticated, service_role;
grant select, insert, update, delete on public.scheduled_emails to anon, authenticated, service_role;

-- Seed: one linked staff member (auth_id set) and one row per table to read/update.
insert into public.team_members (id, name, email, role, auth_id, is_active) values
  ('tm-staff','Rep Staff','rep@nsa.test','rep','11111111-1111-1111-1111-111111111111', true),
  ('tm-floor','Floor Worker',null,'warehouse', null, true);
insert into public.app_state (id, value) values ('company_info','{"name":"NSA"}');
insert into public.scheduled_emails (id, send_at, payload) values ('22222222-2222-2222-2222-222222222222', now(), '{}');
