-- e2e/pipeline/seed.sql
--
-- Supabase-parity schema stubs + baseline reference data for the Team Shop /
-- Club order pipeline end-to-end harness. Run against a FRESH scratch
-- Postgres 16 database, BEFORE the real migrations 00191-00212 (drive.sql
-- applies those). See e2e/pipeline/README.md for the full picture.
--
-- WHAT BELONGS HERE vs drive.sql (important — read before editing):
--   This file defines/seeds ONLY tables and columns that PRE-DATE migration
--   00191 (i.e. nothing in 00191-00212 creates them). Every table/column that
--   one of the 22 real migrations creates via `create table if not exists` /
--   `alter table ... add column if not exists` is deliberately NOT stubbed
--   here — pre-creating it would let a bug in that migration's own DDL hide
--   behind a no-op "if not exists". Concretely, that means:
--     * order A (Team Shop) needs webstore_orders.order_source/coach_id/
--       customer_id and webstore_order_items.decorations/unit_deco_price,
--       all added by migration 00195 — so order A's order rows and its
--       teamshop_logos row (table created by 00194) are seeded in drive.sql,
--       AFTER `\ir`-ing the migrations, not here.
--     * order B (Club) touches no column any in-range migration adds, so it
--       is seeded here, in full, below.
--     * webstore_transfers.unit_cost is added by 00204, so order B's
--       transfer row is seeded here WITHOUT unit_cost; drive.sql sets it
--       after 00204 applies.
--   This split is verified against every `create table` / `add column`
--   statement in 00191-00212 (see the PR/commit description for the audit).
--
-- Derived from the prior scratch stub at
-- /tmp/claude-0/-home-user/215fbc80-42f1-5f41-be33-39b7bf8bace4/scratchpad/migverify/00_stubs.sql
-- (itself derived from 00007_app_schema_alignment.sql + later alters),
-- extended with: club-store columns (org_type/customer_id/subtotal/
-- fundraise_amt/discount_amt/player_name/player_number/unit_fundraise/
-- bundle_product_id/transfer_code/roster/names/...), webstore_products /
-- webstore_bundle_items / customer_credits (all pre-existing, no CREATE
-- TABLE migration in this repo), the 00161 batch-PO allocator, the 00177
-- batch-number trigger, app_counters/next_counter (00181), and the
-- migration-037 webstore_status_monotonic trigger (the "shipped bridge").
\set ON_ERROR_STOP on

-- ── Roles (Supabase-managed) ────────────────────────────────────────────────
-- Roles are CLUSTER-wide, not per-database — a scratch cluster reused across
-- runs (or across other harnesses on the same Postgres instance) may already
-- have these from a prior session, so create them idempotently.
do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

-- ── auth schema stubs ───────────────────────────────────────────────────────
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub',
                          current_setting('request.jwt.claim.sub', true)), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to public;

-- ── storage schema stubs (what 00191/00201 touch) ───────────────────────────
create schema storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- ── Supabase default privileges on public schema ────────────────────────────
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ── is_team_member() stub — flips on session GUC app.is_staff ───────────────
create function public.is_team_member() returns boolean
language sql stable security definer as
$$ select coalesce(nullif(current_setting('app.is_staff', true), ''), 'false')::boolean $$;
grant execute on function public.is_team_member() to public;

-- ── Core tables (00007-era shapes, trimmed to what this pipeline touches) ───
create table public.team_members (
  id text primary key,
  name text not null,
  role text not null,
  email text,
  is_active boolean default true
);

create table public.customers (
  id text primary key,
  name text not null,
  payment_terms text default 'net30',
  tax_rate numeric,
  tax_exempt boolean default false,
  primary_rep_id text references public.team_members(id),
  is_active boolean default true,
  art_files jsonb default '[]',            -- staff art library (customers.art_files) — pre-existing
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table public.vendors (id text primary key, name text not null);

create table public.products (
  id text primary key,
  vendor_id text references public.vendors(id),
  sku text not null,
  name text not null,
  brand text,
  color text,
  retail_price numeric,
  nsa_cost numeric,
  is_clearance boolean default false,       -- pre-existing (club cost-basis rule)
  clearance_cost numeric,                   -- pre-existing
  is_active boolean default true
);

create table public.sales_orders (
  id text primary key,
  customer_id text references public.customers(id),
  memo text,
  status text default 'need_order',
  created_by text references public.team_members(id),
  created_at text,
  updated_at text,
  expected_date text,
  production_notes text,
  shipping_type text,
  shipping_value numeric default 0,
  ship_to_id text default 'default',
  default_markup numeric default 1.65,
  deleted_at timestamptz,
  -- 00036
  tax_rate numeric default 0,
  tax_exempt boolean default false,
  -- 00049
  _version int not null default 1,
  -- pre-repo live columns referenced by 00196/00199/00204/00207
  _webstore_fundraise numeric,
  source text,
  webstore_id uuid,
  -- 00177_webstore_batches
  webstore_batch_no integer,
  webstore_batch_label text,
  webstore_batch_cutoff timestamptz,
  -- pre-repo live columns the migration-037 shipped-bridge trigger reads
  _shipped boolean default false,
  _shipping_status text
);

create table public.so_items (
  -- serial (int), NOT uuid: verified against 00202's teamshop_auto_po_needs
  -- (so_item_id int not null) — the uuid fix only applies to
  -- webstore_order_items.id below, a different table.
  id serial primary key,
  so_id text not null references public.sales_orders(id) on delete cascade,
  item_index int not null,
  product_id text references public.products(id),
  sku text,
  name text,
  brand text,
  color text,
  nsa_cost numeric,
  retail_price numeric,
  unit_sell numeric,
  sizes jsonb default '{}',
  available_sizes jsonb default '[]',
  no_deco boolean default false,
  est_qty numeric                            -- pre-existing (auto-release fulfillment fallback)
);

create table public.so_item_decorations (
  id serial primary key,
  so_item_id int not null references public.so_items(id) on delete cascade,
  deco_index int not null,
  kind text,
  position text,
  type text,
  art_file_id text,
  sell_override numeric,
  sell_each numeric,
  cost_each numeric,
  underbase boolean default false,
  colors int,
  stitches int,
  dtf_size int,
  -- 00169
  web_url text,
  placement text,
  side text,
  color_label text,
  -- pre-existing, post-00007 columns the club RPC (00204/00207) reads/writes
  transfer_code text,
  num_method text,
  num_size text,
  two_color boolean,
  roster jsonb,
  names jsonb
);

create table public.so_jobs (
  id text not null,
  so_id text not null references public.sales_orders(id) on delete cascade,
  key text,
  art_file_id text,
  art_name text,
  deco_type text,
  positions text,
  art_status text default 'needs_art',
  item_status text default 'need_to_order',
  prod_status text default 'hold',
  total_units int default 0,
  fulfilled_units int default 0,
  split_from text,
  created_at text,
  ship_method text,
  items jsonb default '[]',
  _auto boolean default false,
  -- 00024
  _art_ids jsonb,
  -- pre-repo live column referenced by 00192 ('completed_at' stamp)
  completed_at timestamptz,
  primary key (so_id, id)
  -- NOT stubbed on purpose (added for real by in-range migrations):
  --   decorated_at/decorated_by/packed_at/digitizing_vendor/
  --   digitizing_sent_at/digitizing_due_at (00192), digitizing_needed
  --   (00196), notes (00210), dtf_prints_status (00212).
);

create table public.invoices (
  id text primary key,
  customer_id text references public.customers(id),
  so_id text references public.sales_orders(id) on delete set null,
  type text default 'invoice',
  date text,
  due_date text,
  total numeric default 0,
  paid numeric default 0,
  memo text,
  status text default 'open',
  cc_fee numeric default 0,
  created_by text references public.team_members(id),
  deleted_at timestamptz,
  -- 00029
  inv_type text,
  tax numeric default 0,
  tax_rate numeric default 0,
  tax_exempt boolean default false,
  shipping numeric default 0,
  line_items jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- 00180
  _version int not null default 1
);

create table public.invoice_payments (
  id serial primary key,
  invoice_id text not null references public.invoices(id) on delete cascade,
  amount numeric,
  method text,
  ref text,
  date text
);

create table public.invoice_items (
  id serial primary key,
  invoice_id text not null references public.invoices(id) on delete cascade,
  sku text,
  name text,
  qty int,
  unit_price numeric,
  total numeric,
  description text
);

-- ── Customer credits (supabase_migration_005_customer_credits.sql shape,
--    + is_fundraise which predates this repo's migration set but is read/
--    written by 00204/00207) ──────────────────────────────────────────────
create table public.customer_credits (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  amount numeric not null default 0,
  used numeric not null default 0,
  source text,
  created_by text,
  created_at timestamptz default now(),
  is_fundraise boolean default false
);

-- ── Coach tables (00130 / 00163 shapes) ─────────────────────────────────────
create table public.coach_accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  auth_user_id uuid unique,
  email text not null unique,
  name text,
  customer_id text not null,
  status text not null default 'active'
);
create table public.coach_customer_access (
  coach_id uuid not null references public.coach_accounts(id) on delete cascade,
  customer_id text not null,
  role text not null default 'editor',
  created_at timestamptz default now(),
  primary key (coach_id, customer_id)
);

-- ── Webstore tables (pre-repo; columns per 00134/00170/00171/00177 usage,
--    plus club-store columns org_type/customer_id which 00204's own header
--    confirms are pre-existing: "every webstore has always had this
--    column — it is NOT new") ─────────────────────────────────────────────
create table public.webstores (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text,
  source text,
  status text,
  payment_mode text,
  delivery_mode text,
  flat_shipping numeric,
  processing_pct numeric,
  fundraise_enabled boolean,
  number_unique boolean,
  public_listed boolean,
  is_template boolean,
  org_type text,                 -- pre-existing: 'club' | 'team' | null (00204)
  customer_id text references public.customers(id), -- pre-existing: club store's one customer (00204)
  created_at timestamptz default now()
);

create sequence public.webstore_order_number_seq as bigint start with 1010000; -- 00177
create table public.webstore_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.webstores(id),
  status text,
  so_id text,
  buyer_name text,
  buyer_email text,
  total numeric,
  client_ref text,                                                   -- 00170
  order_number bigint default nextval('webstore_order_number_seq'),  -- 00177
  -- pre-existing club-order economics (026/pre-repo; NOT added by 00191-00212)
  subtotal numeric,
  fundraise_amt numeric,
  discount_amt numeric,
  -- pre-existing transfer-pull stamps (migration 026_transfer_lifecycle.sql;
  -- 00206 reads/writes these but does not ALTER TABLE for them)
  transfers_pulled boolean default false,
  transfers_pulled_at timestamptz,
  created_at timestamptz default now()
  -- NOT stubbed on purpose: order_source/coach_id/customer_id/quote_hash
  -- (00195), po_number/po_doc_path/po_rejected_reason/po_reviewed_by/
  -- po_reviewed_at (00201) — all added for real by in-range migrations.
);

create table public.webstore_order_items (
  -- uuid, not serial: verified against the live project's information_schema
  -- (see e2e/pipeline/README.md) — the club RPC's temp tables declare
  -- item_id uuid and select webstore_order_items.id straight into them.
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.webstore_orders(id) on delete cascade,
  product_id text,
  sku text,
  name text,
  color text,
  size text,
  qty int,
  unit_price numeric,
  is_bundle_parent boolean default false,
  -- pre-existing club/personalization columns (NOT added by 00191-00212)
  player_name text,
  player_number text,
  unit_fundraise numeric,
  bundle_product_id uuid,
  -- pre-existing (migration 037) — the shipped-bridge trigger's write target
  line_status text default 'pending'
  -- NOT stubbed on purpose: decorations/unit_deco_price (00195).
);

-- Catalog tables the club RPC reads (pre-existing; no CREATE TABLE migration
-- for either exists in this repo — same conclusion the prior club scratch
-- harness reached).
create table public.webstore_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.webstores(id),
  product_id text,
  decorations jsonb default '[]',
  transfer_codes text[],
  takes_number boolean default false,
  takes_name boolean default false
);
create table public.webstore_bundle_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid,
  product_id text,
  takes_number boolean default false,
  takes_name boolean default false,
  transfer_code text
);

-- Heat-transfer inventory (real migration 017_webstore_transfers.sql shape).
-- unit_cost is NOT included here on purpose — 00204 adds it; drive.sql sets
-- this row's unit_cost only after 00204 has applied.
create table public.webstore_transfers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.webstores(id) on delete cascade,
  code text not null,
  label text not null,
  kind text not null default 'design',
  on_hand int not null default 0,
  created_at timestamptz default now(),
  unique (store_id, code)
);

-- 00177_webstore_batches trigger (00196/00199/00204/00207 rely on it
-- assigning webstore_batch_no).
create function public.assign_webstore_batch_no() returns trigger as $$
begin
  perform 1 from webstores where id = new.webstore_id for update;
  select coalesce(max(webstore_batch_no), 0) + 1 into new.webstore_batch_no
    from sales_orders where webstore_id = new.webstore_id;
  return new;
end $$ language plpgsql;
create trigger trg_assign_webstore_batch_no
  before insert on public.sales_orders
  for each row
  when (new.webstore_id is not null and new.webstore_batch_no is null)
  execute function public.assign_webstore_batch_no();
create unique index idx_sales_orders_webstore_batch_no
  on public.sales_orders (webstore_id, webstore_batch_no)
  where webstore_id is not null and webstore_batch_no is not null;

-- ── 00161 batch PO number allocator (real definition, minus app_state seed) ─
create table public.batch_po_numbers (
  n integer primary key,
  claimed_by text,
  claimed_at timestamptz not null default now()
);
alter table public.batch_po_numbers enable row level security;
insert into public.batch_po_numbers(n, claimed_by) values (4500, 'pipeline-seed');

create or replace function public.claim_batch_po_number(p_number integer, p_claimed_by text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform pg_advisory_xact_lock(hashtext('batch_po_numbers'));
  if p_number is null or exists (select 1 from batch_po_numbers where n = p_number) then
    select greatest(coalesce(max(n), 4500), coalesce(p_number, 0)) + 1 into v_n from batch_po_numbers;
  else
    v_n := p_number;
  end if;
  insert into batch_po_numbers(n, claimed_by) values (v_n, left(coalesce(p_claimed_by,''), 120));
  return v_n;
end $$;

-- ── app_counters / next_counter (real migration 00181 shape) ────────────────
-- Not actually read/written by anything in 00191-00212 (verified: no
-- reference to next_counter/app_counters in those 22 files) — included only
-- because the task's table list names it and it costs nothing to have.
create table public.app_counters (
  key text primary key,
  value bigint not null default 0
);
alter table public.app_counters enable row level security;
create or replace function public.next_counter(p_key text, p_start bigint default 1)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into app_counters(key, value) values (p_key, p_start)
    on conflict (key) do update set value = app_counters.value + 1
    returning value into v;
  return v;
end $$;

-- ── Migration-037 "shipped bridge" trigger (real, verbatim; PRE-DATES
--    00191 — this is the trigger 00191-00212 assume is already live, the
--    same way they assume is_team_member()/claim_batch_po_number/
--    assign_webstore_batch_no are already live). Copied byte-for-byte from
--    supabase_migration_037_webstore_status_monotonic.sql. Advances
--    webstore_order_items.line_status when a linked SO's _shipped/
--    _shipping_status/status crosses a stage boundary; never downgrades.
create function webstore_sync_status() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ls text;
  target_idx int;
begin
  if new.webstore_id is null then return new; end if;

  ls := case
    when coalesce(new._shipped, false)
      or new._shipping_status ilike 'ship%'
      or new._shipping_status ilike 'deliver%'                       then 'shipped'
    when new.status in ('complete','completed','done')               then 'complete'
    when new.status in ('in_production','needs_pull','staging','in_process') then 'in_production'
    when new.status in ('items_received')                            then 'received'
    else null
  end;
  if ls is null then return new; end if;

  target_idx := case ls
    when 'received'      then 1
    when 'in_production' then 2
    when 'bagging'       then 3
    when 'shipped'       then 4
    when 'complete'      then 4
    else 0
  end;

  update webstore_order_items i
     set line_status = ls
   where i.order_id in (select id from webstore_orders where so_id = new.id)
     and coalesce(i.line_status, 'pending') <> 'cancelled'
     and (case coalesce(i.line_status, 'pending')
            when 'received'      then 1
            when 'in_production' then 2
            when 'bagging'       then 3
            when 'shipped'       then 4
            when 'complete'      then 4
            else 0
          end) < target_idx;

  return new;
end;
$$;

create trigger trg_webstore_sync_status
  after insert or update of status, _shipping_status, _shipped on sales_orders
  for each row execute function webstore_sync_status();

-- Grants on the stub tables (Supabase grants all to the three roles)
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- 00191 drops these pre-existing 00040 storage policies; create matching stubs
create policy "auth_upload_artwork" on storage.objects for insert to authenticated with check (bucket_id = 'artwork');
create policy "auth_update_artwork" on storage.objects for update to authenticated using (bucket_id = 'artwork');
create policy "auth_delete_artwork" on storage.objects for delete to authenticated using (bucket_id = 'artwork');
create policy "public_read_artwork" on storage.objects for select using (bucket_id = 'artwork');

-- ═════════════════════════════════════════════════════════════════════════
-- Reference / seed data
-- ═════════════════════════════════════════════════════════════════════════
\echo '=== seed.sql: reference data ==='

insert into team_members (id, name, role) values ('TM-1', 'Rep One', 'rep');

-- ── Order A (Team Shop) — customer/product/coach side only. The order rows
--    themselves are seeded in drive.sql (need columns 00195 adds). ─────────
insert into customers (id, name, primary_rep_id, payment_terms, art_files) values
  ('CUST-TS', 'Tigers Youth FC', 'TM-1', 'net30',
   '[{"id":"art-tigers-1","name":"Tigers Crest (Embroidery)","deco_type":"embroidery",
      "status":"approved","prod_files_attached":true,
      "prod_files":[{"name":"DG100_TIGERS.DST","url":"https://cdn.example/dg100.dst"}]}]'::jsonb);

insert into products (id, sku, name, brand, color, retail_price, nsa_cost) values
  ('P-TEE-TS',  'PC54TS',  'Core Cotton Tee',   'Port & Co', 'Black', 16.00, 3.50),
  ('P-HOOD-TS', 'PC78HTS', 'Core Fleece Hoodie','Port & Co', 'Black', 30.00, 12.00);

insert into coach_accounts (id, auth_user_id, email, customer_id, status) values
  ('a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111',
   'coach@tigersfc.example', 'CUST-TS', 'active');

insert into webstores (slug, name, source, status, payment_mode, delivery_mode, flat_shipping,
                        processing_pct, fundraise_enabled, number_unique, public_listed, is_template)
values ('nationalteamshop', 'National Team Shop', 'teamshop', 'open', 'paid',
        'ship_home', 0, 0, false, false, false, false);
-- (Deliberately the same slug/shape migration 00195 seeds — its own
-- `insert ... where not exists` guard is exercised as a real no-op in
-- drive.sql once it runs, instead of being pre-empted here.)

-- ── Order B (Club) — full seed; touches no in-range-migration column ───────
insert into customers (id, name, primary_rep_id, payment_terms, art_files) values
  ('CUST-CLUB', 'Ridge FC', 'TM-1', 'net30',
   '[{"id":"art-ridge-crest","name":"Ridge Crest","deco_type":"embroidery",
      "status":"approved","prod_files_attached":true,
      "prod_files":[{"name":"DG555_RIDGE.DST","url":"https://cdn.example/dg555.dst"}]}]'::jsonb);

insert into products (id, sku, name, brand, color, retail_price, nsa_cost, is_clearance, clearance_cost) values
  ('P-TEE',  'T100', 'Club Tee',    'NSA', 'Red',  20, 6.00,  false, null),
  ('P-HOOD', 'H200', 'Club Hoodie', 'NSA', 'Navy', 45, 14.00, true,  11.50),
  ('P-SOCK', 'S300', 'Club Socks',  'NSA', 'Red',  10, 2.50,  false, null);

insert into webstores (id, slug, name, org_type, customer_id, delivery_mode) values
  ('c1111111-0000-0000-0000-000000000001', 'ridge-fc', 'Ridge FC Club Store', 'club', 'CUST-CLUB', 'deliver_club'),
  ('c1111111-0000-0000-0000-000000000002', 'team-x',   'Team X Store',       'team', 'CUST-CLUB', 'ship_home');

insert into webstore_transfers (id, store_id, code, label, kind, on_hand) values
  ('c2222222-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000001',
   'RIDGE24', 'Ridge 2024 crest', 'design', 100);

-- Catalog: tee has the production-ready logo placement + a transfer code +
-- takes personalization; hoodie is plain; socks are a bundle component
-- carrying a transfer_code.
insert into webstore_products (store_id, product_id, decorations, transfer_codes, takes_number, takes_name) values
  ('c1111111-0000-0000-0000-000000000001', 'P-TEE',
   '[{"art_id":"art-ridge-crest","placement":"left_chest","side":"front","art_url":"https://cdn.example/ridge-crest.png"}]'::jsonb,
   array['RIDGE24'], true, true),
  ('c1111111-0000-0000-0000-000000000001', 'P-HOOD', '[]'::jsonb, null, false, false);

insert into webstore_bundle_items (bundle_id, product_id, transfer_code) values
  ('c3333333-0000-0000-0000-000000000001', 'P-SOCK', 'RIDGE24');

-- Order: $130 garment subtotal + $13 fundraise − $14.30 coupon (disc_ratio
-- 0.9). Total collected $128.70 — chosen so the invoice settles fully
-- 'paid' (not 'partial'): invoice total, independent of the order header,
-- is Σ so_items.unit_sell×qty = 19.80×3 + 44.55×1 + 24.75×1 = 128.70.
-- drive.sql asserts every one of these figures against the real RPC output.
insert into webstore_orders (id, store_id, status, order_number, buyer_name, buyer_email,
                             subtotal, fundraise_amt, discount_amt, total) values
  ('c4444444-0000-0000-0000-000000000001', 'c1111111-0000-0000-0000-000000000001',
   'paid', 5001, 'Pat Doe', 'pat@example.com', 130, 13, 14.3, 128.7);

insert into webstore_order_items (order_id, product_id, sku, size, qty, unit_price, unit_fundraise,
                                  player_name, player_number, is_bundle_parent, bundle_product_id) values
  ('c4444444-0000-0000-0000-000000000001', 'P-TEE',  'T100', 'M',  2, 20, 2,   null,  null, false, null),
  ('c4444444-0000-0000-0000-000000000001', 'P-TEE',  'T100', 'L',  1, 20, 2,   'DOE', '12', false, null),
  ('c4444444-0000-0000-0000-000000000001', 'P-HOOD', 'H200', 'XL', 1, 45, 4.5, null,  null, false, null),
  -- bundle: parent P-KIT collects $25+$2.50fr; one child sock at $0
  ('c4444444-0000-0000-0000-000000000001', 'P-KIT',  'KIT1', 'OS', 1, 25, 2.5, null,  null, true,  'c3333333-0000-0000-0000-000000000001'),
  ('c4444444-0000-0000-0000-000000000001', 'P-SOCK', 'S300', 'OS', 1, 0,  0,   null,  null, false, 'c3333333-0000-0000-0000-000000000001');

-- Guard fixtures (cheap, already-derived numbers): an UNPAID club order and a
-- PAID order on a non-club ('team') store — drive.sql asserts both are
-- rejected by create_club_sales_order's guards.
insert into webstore_orders (id, store_id, status, order_number, subtotal, total) values
  ('c4444444-0000-0000-0000-000000000002', 'c1111111-0000-0000-0000-000000000001', 'pending_payment', 5002, 20, 20),
  ('c4444444-0000-0000-0000-000000000003', 'c1111111-0000-0000-0000-000000000002', 'paid',            5003, 20, 20);

\echo '=== seed.sql complete ==='
