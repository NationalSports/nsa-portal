-- Scratch-DB harness for migration 20261007120000_so_shipping_labels_out_of_orders.sql.
-- Self-contained: builds a minimal sales_orders with production's _version / updated_at /
-- audit triggers, seeds inline label PDFs, applies the migration, then proves the backfill and
-- the trigger. Never run against a real database — it CREATEs its own roles and tables.
-- Ends with ALL_SO_SHIPPING_LABEL_SCENARIOS_PASSED.
\set ON_ERROR_STOP 1

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.auth_uid', true), '')::uuid;
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.team_members (id text primary key, auth_id uuid, is_active boolean default true);
insert into public.team_members values ('tm-staff', '11111111-1111-1111-1111-111111111111', true);
create or replace function public.is_team_member() returns boolean language sql stable security definer
set search_path to 'public' as $$
  select exists (select 1 from public.team_members tm where tm.auth_id = (select auth.uid()) and coalesce(tm.is_active, true));
$$;

-- Production definitions of the triggers that already sit on sales_orders.
create or replace function public.increment_version() returns trigger language plpgsql as $$
begin new._version := coalesce(old._version, 0) + 1; return new; end $$;
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create table public.audit_log (id bigserial primary key, table_name text, op text, row_id text, old_data jsonb, new_data jsonb);
create or replace function public.audit_log_trigger() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(old) is distinct from to_jsonb(new) then
    insert into public.audit_log(table_name, op, row_id, old_data, new_data) values (tg_table_name, 'UPDATE', new.id, to_jsonb(old), to_jsonb(new));
  elsif tg_op = 'INSERT' then
    insert into public.audit_log(table_name, op, row_id, new_data) values (tg_table_name, 'INSERT', new.id, to_jsonb(new));
  end if;
  return new;
end $$;

create table public.sales_orders (
  id text primary key, memo text, updated_at text, _version integer default 1, _shipments jsonb
);
create trigger trg_sales_orders_updated before update on public.sales_orders for each row execute function public.set_updated_at();
create trigger trg_sales_orders_version before update on public.sales_orders for each row execute function public.increment_version();
create trigger audit_log_trg after insert or delete or update on public.sales_orders for each row execute function public.audit_log_trigger();
alter table public.sales_orders enable row level security;
create policy sales_orders_read on public.sales_orders for select to anon, authenticated using (true);
create policy sales_orders_staff_write on public.sales_orders for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
grant select, insert, update, delete on public.sales_orders to anon, authenticated, service_role;

-- Seed (inserted before the migration, so no trigger touches them yet).
insert into public.sales_orders (id, memo, _version, _shipments) values
  ('SO-1', 'two labels + one https + one none', 4, jsonb_build_array(
     jsonb_build_object('id','SHP-a','tracking_number','1Z1','label_url','data:application/pdf;base64,AAAA','items',jsonb_build_array(jsonb_build_object('sku','X','qty',2))),
     jsonb_build_object('id','SHP-b','tracking_number','1Z2','label_url','https://ssapi.shipstation.com/label/1'),
     jsonb_build_object('id','SHP-c','tracking_number','','label_url',null),
     jsonb_build_object('id','SHP-d','tracking_number','1Z4','label_url','data:application/pdf;base64,BBBB'))),
  ('SO-2', 'no shipments', 1, '[]'::jsonb),
  ('SO-3', 'null shipments', 1, null),
  ('SO-4', 'same PDF as SO-1 SHP-a', 2, jsonb_build_array(
     jsonb_build_object('id','SHP-e','label_url','data:application/pdf;base64,AAAA'))),
  ('SO-5', 'non-array legacy value', 1, '{"label_url":"data:application/pdf;base64,CCCC"}'::jsonb);

\i supabase/migrations/20261007120000_so_shipping_labels_out_of_orders.sql

do $$
declare r record; v jsonb;
begin
  -- S1: backfill replaced both data URLs with references, kept order, and left everything else alone.
  select * into r from public.sales_orders where id = 'SO-1';
  v := r._shipments;
  if jsonb_array_length(v) <> 4 then raise exception 'S1 length changed: %', v; end if;
  if v->0->>'label_url' <> 'nsa-label:' || md5('data:application/pdf;base64,AAAA') then raise exception 'S1 SHP-a ref wrong: %', v->0; end if;
  if v->3->>'label_url' <> 'nsa-label:' || md5('data:application/pdf;base64,BBBB') then raise exception 'S1 SHP-d ref wrong: %', v->3; end if;
  if v->1->>'label_url' <> 'https://ssapi.shipstation.com/label/1' then raise exception 'S1 https label touched'; end if;
  if v->2->'label_url' <> 'null'::jsonb then raise exception 'S1 null label touched'; end if;
  if (v->0) - 'label_url' <> jsonb_build_object('id','SHP-a','tracking_number','1Z1','items',jsonb_build_array(jsonb_build_object('sku','X','qty',2)))
    then raise exception 'S1 other SHP-a fields changed: %', v->0; end if;
  if array(select e->>'id' from jsonb_array_elements(v) e) <> array['SHP-a','SHP-b','SHP-c','SHP-d'] then raise exception 'S1 order changed'; end if;
  -- S2: the PDF bytes are stored, once each; SO-4's identical PDF reuses SO-1's row.
  if (select count(*) from public.so_shipping_labels) <> 2 then raise exception 'S2 expected 2 label rows, got %', (select count(*) from public.so_shipping_labels); end if;
  if (select data_url from public.so_shipping_labels where id = md5('data:application/pdf;base64,BBBB')) <> 'data:application/pdf;base64,BBBB' then raise exception 'S2 BBBB bytes wrong'; end if;
  if (select _shipments->0->>'label_url' from public.sales_orders where id = 'SO-4') <> 'nsa-label:' || md5('data:application/pdf;base64,AAAA') then raise exception 'S2 SO-4 not deduped'; end if;
  -- S3: rows without inline PDFs were not rewritten (version untouched); rewritten rows bumped once.
  if (select _version from public.sales_orders where id = 'SO-2') <> 1 then raise exception 'S3 SO-2 version bumped'; end if;
  if (select _shipments from public.sales_orders where id = 'SO-3') is not null then raise exception 'S3 SO-3 changed'; end if;
  if (select _version from public.sales_orders where id = 'SO-1') <> 5 then raise exception 'S3 SO-1 version should be 5, got %', (select _version from public.sales_orders where id = 'SO-1'); end if;
  -- S4: non-array legacy value is left alone (nothing in the app reads it as shipments).
  if (select _shipments from public.sales_orders where id = 'SO-5') <> '{"label_url":"data:application/pdf;base64,CCCC"}'::jsonb then raise exception 'S4 SO-5 changed'; end if;
  raise notice 'S1-S4 backfill passed';
end $$;

-- S5: a staff save (as authenticated, via RLS) that adds a NEW inline label is externalized on
-- the way in, with exactly one _version bump, and the AFTER audit trigger sees the slim row.
set role authenticated;
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
update public.sales_orders
   set _shipments = _shipments || jsonb_build_array(jsonb_build_object('id','SHP-n','label_url','data:application/pdf;base64,NEWPDF'))
 where id = 'SO-2';
reset role;
do $$
declare v jsonb;
begin
  v := (select _shipments from public.sales_orders where id = 'SO-2');
  if v->0->>'label_url' <> 'nsa-label:' || md5('data:application/pdf;base64,NEWPDF') then raise exception 'S5 new label not externalized: %', v; end if;
  if (select _version from public.sales_orders where id = 'SO-2') <> 2 then raise exception 'S5 expected one version bump'; end if;
  if (select so_id || '/' || shipment_id from public.so_shipping_labels where id = md5('data:application/pdf;base64,NEWPDF')) <> 'SO-2/SHP-n' then raise exception 'S5 label row metadata wrong'; end if;
  if (select new_data::text from public.audit_log where row_id = 'SO-2' order by id desc limit 1) like '%NEWPDF%' then raise exception 'S5 audit row still carries the PDF'; end if;
  raise notice 'S5 trigger on staff update passed';
end $$;

-- S6: a stale tab writes the OLD inline copy back — it maps to the same row, no duplicate.
update public.sales_orders set _shipments = jsonb_build_array(jsonb_build_object('id','SHP-e','label_url','data:application/pdf;base64,AAAA')) where id = 'SO-4';
-- S7: a brand-new order inserted with an inline label is externalized too.
insert into public.sales_orders (id, _shipments) values ('SO-6', jsonb_build_array(jsonb_build_object('id','SHP-z','label_url','data:application/pdf;base64,ZZZZ')));
-- S8: an update that does not touch _shipments does not run the externalizer (column trigger).
update public.sales_orders set memo = 'memo only' where id = 'SO-5';
do $$
begin
  if (select _shipments->0->>'label_url' from public.sales_orders where id = 'SO-4') <> 'nsa-label:' || md5('data:application/pdf;base64,AAAA') then raise exception 'S6 stale write not externalized'; end if;
  if (select count(*) from public.so_shipping_labels where id = md5('data:application/pdf;base64,AAAA')) <> 1 then raise exception 'S6 duplicate label row'; end if;
  if (select _shipments->0->>'label_url' from public.sales_orders where id = 'SO-6') <> 'nsa-label:' || md5('data:application/pdf;base64,ZZZZ') then raise exception 'S7 insert not externalized'; end if;
  if (select _shipments from public.sales_orders where id = 'SO-5') <> '{"label_url":"data:application/pdf;base64,CCCC"}'::jsonb then raise exception 'S8 SO-5 changed'; end if;
  raise notice 'S6-S8 passed';
end $$;

-- S9: access. Staff read labels; anon and non-staff authenticated users read nothing; neither
-- can write labels directly or call the helper over RPC.
set role authenticated;
select set_config('test.auth_uid', '11111111-1111-1111-1111-111111111111', false);
do $$ begin if (select count(*) from public.so_shipping_labels) < 4 then raise exception 'S9 staff cannot read labels'; end if; end $$;
select set_config('test.auth_uid', '99999999-9999-9999-9999-999999999999', false);
do $$ begin if (select count(*) from public.so_shipping_labels) <> 0 then raise exception 'S9 non-staff authenticated can read labels'; end if; end $$;
do $$ begin
  begin insert into public.so_shipping_labels (id, data_url) values ('x', 'data:x'); raise exception 'S9 authenticated insert allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.externalize_so_label_pdfs('SO-1', '[]'::jsonb); raise exception 'S9 authenticated may call helper';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform count(*) from public.so_shipping_labels; raise exception 'S9 anon can select labels';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo ALL_SO_SHIPPING_LABEL_SCENARIOS_PASSED
