-- Scratch-DB fixture mirroring the production tables place_webstore_order touches.
-- Table definitions copied from supabase_migration_011_webstores.sql (orders/items/
-- claims) + 00170 (client_ref); FK targets stubbed minimally; Supabase roles created
-- so the migration's grant/revoke statements run as-is.
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

-- FK stubs
create table webstores (id uuid primary key default gen_random_uuid(), slug text, name text);
create table products (id text primary key);
create table sales_orders (id text primary key);
create table webstore_products (id uuid primary key default gen_random_uuid());

-- Real definitions (migration 011)
create table webstore_orders (
  id              uuid primary key default gen_random_uuid(),
  store_id        uuid not null references webstores(id),
  status          text not null default 'pending',
  payment_mode    text not null,
  order_kind      text not null default 'individual',
  buyer_name      text,
  buyer_email     text,
  buyer_phone     text,
  ship_address    jsonb,
  ship_method     text default 'ship',
  subtotal        numeric not null default 0,
  fundraise_amt   numeric default 0,
  tax             numeric default 0,
  shipping        numeric default 0,
  total           numeric not null default 0,
  stripe_pi_id    text,
  so_id           text references sales_orders(id),
  status_token    text unique default encode(gen_random_bytes(16),'hex'),
  notes           text,
  created_at      timestamptz default now(),
  -- columns added by later migrations that checkout writes
  shipping_fee    numeric default 0,
  processing_fee  numeric default 0,
  coupon_code     text,
  discount_amt    numeric default 0,
  confirmation_sent boolean default false
);
-- 00170
alter table webstore_orders add column if not exists client_ref text;
create unique index if not exists webstore_orders_client_ref_key
  on webstore_orders (client_ref) where client_ref is not null;

create table webstore_order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references webstore_orders(id) on delete cascade,
  product_id      text references products(id),
  sku             text,
  size            text,
  qty             int not null default 1,
  unit_price      numeric not null default 0,
  unit_fundraise  numeric default 0,
  decoration_id   uuid,
  player_name     text,
  player_number   text,
  bundle_ref        uuid,
  bundle_product_id uuid references webstore_products(id),
  is_bundle_parent  boolean default false,
  line_status     text default 'pending',
  backordered     boolean default false,
  name            text,
  color           text,
  variant_label   text,
  image_url       text
);

create table webstore_number_claims (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references webstores(id) on delete cascade,
  player_number text not null,
  order_id      uuid references webstore_orders(id) on delete cascade,
  player_name   text,
  claimed_at    timestamptz default now(),
  unique (store_id, player_number)
);

-- seed
insert into webstores (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'tigers', 'Tigers');
insert into products (id) values ('p1');
insert into webstore_products (id) values ('00000000-0000-0000-0000-0000000000aa');
