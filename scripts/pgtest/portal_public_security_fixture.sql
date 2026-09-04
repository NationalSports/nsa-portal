-- Minimal scratch schema for the two portal public-security migrations.
-- Run only in a disposable PostgreSQL/PGlite database.
create schema if not exists auth;

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create or replace function public.is_team_member()
returns boolean language sql stable security definer
set search_path = public, pg_catalog
as $$ select coalesce(current_setting('app.staff', true), 'off') = 'on' $$;
grant execute on function public.is_team_member() to public;

create or replace function public.is_admin_member()
returns boolean language sql stable security definer
set search_path = public, pg_catalog
as $$ select coalesce(current_setting('app.admin', true), 'off') = 'on' $$;
grant execute on function public.is_admin_member() to public;

create table public.app_state (
  id text primary key,
  value text,
  version integer not null default 0,
  updated_at timestamptz default now()
);
alter table public.app_state enable row level security;
create policy app_state_read on public.app_state
  for select to anon, authenticated
  using (id <> 'comm_rep_comp' or public.is_admin_member());
create policy app_state_staff_write on public.app_state
  for all to authenticated
  using (public.is_team_member() and (id <> 'comm_rep_comp' or public.is_admin_member()))
  with check (public.is_team_member() and (id <> 'comm_rep_comp' or public.is_admin_member()));
grant all on public.app_state to public, anon, authenticated, service_role;

create table public.customers (
  id text primary key,
  parent_id text references public.customers(id),
  alpha_tag text
);

do $$
declare t text;
begin
  foreach t in array array[
    'customer_contacts','customer_credits','customer_promo_periods','customer_promo_programs',
    'estimates','sales_orders','invoices'
  ] loop
    execute format('create table public.%I (id text primary key, customer_id text)', t);
  end loop;
  foreach t in array array['customer_credit_usage'] loop
    execute format('create table public.%I (id text primary key, credit_id text)', t);
  end loop;
  foreach t in array array['customer_promo_usage'] loop
    execute format('create table public.%I (id text primary key, period_id text)', t);
  end loop;
  foreach t in array array['estimate_items','estimate_art_files'] loop
    execute format('create table public.%I (id text primary key, estimate_id text)', t);
  end loop;
  create table public.estimate_item_decorations (id text primary key, estimate_item_id text);
  foreach t in array array['so_items','so_jobs','so_art_files','so_firm_dates'] loop
    execute format('create table public.%I (id text primary key, so_id text)', t);
  end loop;
  foreach t in array array['so_item_decorations','so_item_pick_lines','so_item_po_lines'] loop
    execute format('create table public.%I (id text primary key, so_item_id text)', t);
  end loop;
  foreach t in array array['invoice_items','invoice_payments'] loop
    execute format('create table public.%I (id text primary key, invoice_id text)', t);
  end loop;
end $$;

create or replace function public.search_customers(
  p_query text default null,
  p_rep_id text default null,
  p_active_only boolean default true,
  p_limit integer default 50,
  p_offset integer default 0
) returns setof public.customers language sql stable
as $$ select * from public.customers limit p_limit offset p_offset $$;

do $$
declare t text;
begin
  foreach t in array array[
    'customers','customer_contacts','customer_credits','customer_credit_usage',
    'customer_promo_periods','customer_promo_programs','customer_promo_usage',
    'estimates','estimate_items','estimate_art_files','estimate_item_decorations',
    'sales_orders','so_items','so_jobs','so_art_files','so_item_decorations',
    'so_item_pick_lines','so_item_po_lines','so_firm_dates',
    'invoices','invoice_items','invoice_payments'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_old_public', t);
    execute format('grant all on public.%I to public, anon, authenticated, service_role', t);
  end loop;
end $$;
grant execute on function public.search_customers(text,text,boolean,integer,integer) to public, anon, authenticated;

insert into public.customers(id, parent_id, alpha_tag) values
  ('A', null, 'EAGLES'), ('A-1', 'A', 'EAGLES-BASEBALL'), ('B', null, 'TIGERS');
insert into public.sales_orders(id, customer_id) values ('SO-A', 'A'), ('SO-B', 'B');
insert into public.app_state(id, value) values
  ('company_info', '{"name":"NSA"}'),
  ('portal_settings', '{"ccFeePct":0.029}'),
  ('qb_config', '{"realm_id":"secret"}'),
  ('job_time_logs', '[{"employee":"private"}]'),
  ('comm_rep_comp', '{"draw":1000}');
