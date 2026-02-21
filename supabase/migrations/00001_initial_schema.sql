-- ============================================================
-- NSA Portal – Supabase Schema
-- Migration: 00001_initial_schema
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. EXTENSIONS
-- ────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- 1. HELPER: auto-update updated_at
-- ────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ────────────────────────────────────────────────────────────
-- 2. USER_PROFILES
-- ────────────────────────────────────────────────────────────
create table public.user_profiles (
  id          uuid primary key default uuid_generate_v4(),
  auth_id     uuid unique references auth.users(id) on delete set null,
  email       text,
  full_name   text not null,
  role        text not null check (role in (
                'admin','gm','rep','csr','artist','production','warehouse'
              )),
  pin         text,            -- 4-digit quick-login PIN
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_user_profiles_updated
  before update on public.user_profiles
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. CUSTOMERS  (parent / sub-customer hierarchy)
-- ────────────────────────────────────────────────────────────
create table public.customers (
  id                    uuid primary key default uuid_generate_v4(),
  parent_id             uuid references public.customers(id) on delete set null,
  name                  text not null,
  alpha_tag             text,                       -- short PO label
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city          text,
  billing_state         text,
  billing_zip           text,
  shipping_address_line1 text,
  shipping_address_line2 text,
  shipping_city         text,
  shipping_state        text,
  shipping_zip          text,
  pricing_tier          text check (pricing_tier in ('A','B','C','custom')),
  custom_multiplier     numeric(6,4),               -- e.g. 1.6500
  catalog_markup        numeric(6,4),               -- legacy markup field
  tax_rate              numeric(6,4) default 0.0775,
  tax_exempt            boolean not null default false,
  payment_terms         text check (payment_terms in ('net30','net60','prepay')),
  primary_rep_id        uuid references public.user_profiles(id) on delete set null,
  qb_customer_id        text,                       -- QuickBooks link
  notes                 text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_customers_updated
  before update on public.customers
  for each row execute function public.set_updated_at();

create index idx_customers_parent   on public.customers(parent_id);
create index idx_customers_rep      on public.customers(primary_rep_id);
create index idx_customers_alpha    on public.customers(alpha_tag);

-- ────────────────────────────────────────────────────────────
-- 4. CUSTOMER CONTACTS  (multiple per customer)
-- ────────────────────────────────────────────────────────────
create table public.customer_contacts (
  id            uuid primary key default uuid_generate_v4(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  name          text not null,
  email         text,
  phone         text,
  role          text check (role in (
                  'head_coach','assistant','accounting','athletic_director','primary','other'
                )),
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_customer_contacts_cust on public.customer_contacts(customer_id);

-- ────────────────────────────────────────────────────────────
-- 5. VENDORS
-- ────────────────────────────────────────────────────────────
create table public.vendors (
  id                     uuid primary key default uuid_generate_v4(),
  name                   text not null,
  vendor_type            text check (vendor_type in ('api','upload')),
  api_provider           text,   -- sanmar | ss_activewear | momentec | a4
  contact_name           text,
  contact_email          text,
  contact_phone          text,
  rep_name               text,
  website                text,
  account_number         text,
  api_key                text,   -- encrypt at app layer
  api_username           text,
  api_password           text,
  nsa_carries_inventory  boolean not null default false,
  click_automation       boolean not null default false,
  invoice_scan_enabled   boolean not null default false,
  payment_terms          text,
  batch_threshold        numeric(10,2) default 200.00, -- min $ for batch PO
  qb_vendor_id           text,
  notes                  text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_vendors_updated
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 6. PRODUCTS  (parent SKU – one row per style+color)
-- ────────────────────────────────────────────────────────────
create table public.products (
  id              uuid primary key default uuid_generate_v4(),
  vendor_id       uuid references public.vendors(id) on delete set null,
  sku             text not null unique,
  name            text not null,
  brand           text,
  color           text,
  category        text check (category in (
                    'Tees','Hoodies','Polos','Shorts','1/4 Zips',
                    'Hats','Footwear','Jersey Tops','Jersey Bottoms','Balls'
                  )),
  retail_price    numeric(10,2),
  nsa_cost        numeric(10,2),
  available_sizes text[] default '{}',   -- e.g. {XS,S,M,L,XL,2XL}
  image_front_url text,
  image_back_url  text,
  vendor_sku      text,
  upc             text,
  description     text,
  qb_item_id      text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_products_updated
  before update on public.products
  for each row execute function public.set_updated_at();

create index idx_products_vendor   on public.products(vendor_id);
create index idx_products_brand    on public.products(brand);
create index idx_products_category on public.products(category);

-- ────────────────────────────────────────────────────────────
-- 7. PRODUCT_VARIANTS  (one row per size)
-- ────────────────────────────────────────────────────────────
create table public.product_variants (
  id          uuid primary key default uuid_generate_v4(),
  product_id  uuid not null references public.products(id) on delete cascade,
  size        text not null,
  sku         text not null unique,      -- e.g. JX4453-M
  barcode     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create index idx_product_variants_product on public.product_variants(product_id);

-- ────────────────────────────────────────────────────────────
-- 8. INVENTORY  (one row per variant)
-- ────────────────────────────────────────────────────────────
create table public.inventory (
  id            uuid primary key default uuid_generate_v4(),
  variant_id    uuid not null unique references public.product_variants(id) on delete cascade,
  qty_available integer not null default 0,
  qty_allocated integer not null default 0,
  alert_level   integer not null default 0,   -- reorder threshold
  bin_location  text,
  updated_at    timestamptz not null default now()
);

create trigger trg_inventory_updated
  before update on public.inventory
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 9. INVENTORY_ADJUSTMENTS  (audit log)
-- ────────────────────────────────────────────────────────────
create table public.inventory_adjustments (
  id              uuid primary key default uuid_generate_v4(),
  variant_id      uuid not null references public.product_variants(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in (
                    'manual','receiving','pull','return','correction'
                  )),
  qty_change      integer not null,            -- +add / −remove
  reason          text,
  reference_type  text,                        -- po | so | pick_ticket
  reference_id    uuid,
  performed_by    uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index idx_inv_adj_variant on public.inventory_adjustments(variant_id);

-- ────────────────────────────────────────────────────────────
-- 10. DECORATION_TYPES  (reference / lookup)
-- ────────────────────────────────────────────────────────────
create table public.decoration_types (
  id        uuid primary key default uuid_generate_v4(),
  name      text not null,
  code      text not null unique,
  is_active boolean not null default true
);

-- ────────────────────────────────────────────────────────────
-- 11. PRICE_MATRIX  (per-decoration qty-break pricing)
-- ────────────────────────────────────────────────────────────
create table public.price_matrix (
  id                  uuid primary key default uuid_generate_v4(),
  decoration_type_id  uuid not null references public.decoration_types(id) on delete cascade,
  tier_name           text not null,             -- "1 Color", "Up to 5K stitches"
  tier_sort           integer not null default 0,
  qty_min             integer not null,
  qty_max             integer,                   -- null = unlimited
  price_per_piece     numeric(10,4) not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger trg_price_matrix_updated
  before update on public.price_matrix
  for each row execute function public.set_updated_at();

create index idx_price_matrix_deco on public.price_matrix(decoration_type_id);

-- ────────────────────────────────────────────────────────────
-- 12. ART_FILES  (design / artwork repository)
-- ────────────────────────────────────────────────────────────
create table public.art_files (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  deco_type     text check (deco_type in ('screen_print','embroidery','dtf','heat_transfer')),
  ink_colors    text,            -- multi-line color list
  thread_colors text,
  art_size      text,            -- e.g. '12" x 4"'
  files         text[] default '{}',
  mockup_files  text[] default '{}',
  prod_files    text[] default '{}',
  notes         text,
  status        text not null default 'needs_art' check (status in (
                  'needs_art','waiting_approval','uploaded','approved'
                )),
  uploaded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_art_files_updated
  before update on public.art_files
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 13. ESTIMATES
-- ────────────────────────────────────────────────────────────
create table public.estimates (
  id              uuid primary key default uuid_generate_v4(),
  display_id      text not null unique,          -- EST-2089
  customer_id     uuid not null references public.customers(id) on delete cascade,
  memo            text,
  status          text not null default 'draft' check (status in (
                    'draft','sent','approved','converted'
                  )),
  default_markup  numeric(6,4) default 1.6500,
  shipping_type   text check (shipping_type in ('flat','pct')),
  shipping_value  numeric(10,2) default 0,
  ship_to_id      text,                          -- address key
  email_status    text check (email_status in ('sent','opened','viewed')),
  email_opened_at timestamptz,
  email_viewed_at timestamptz,
  created_by      uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_estimates_updated
  before update on public.estimates
  for each row execute function public.set_updated_at();

create index idx_estimates_customer on public.estimates(customer_id);
create index idx_estimates_status   on public.estimates(status);

-- ────────────────────────────────────────────────────────────
-- 14. ESTIMATE_ITEMS
-- ────────────────────────────────────────────────────────────
create table public.estimate_items (
  id            uuid primary key default uuid_generate_v4(),
  estimate_id   uuid not null references public.estimates(id) on delete cascade,
  sort_order    integer not null default 0,
  product_id    uuid references public.products(id) on delete set null,
  sku           text,
  name          text,
  brand         text,
  color         text,
  nsa_cost      numeric(10,2),
  retail_price  numeric(10,2),
  unit_sell     numeric(10,2),
  sizes         jsonb not null default '{}',      -- {"S":5,"M":20,"L":15}
  no_deco       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_estimate_items_est on public.estimate_items(estimate_id);

-- ────────────────────────────────────────────────────────────
-- 15. ESTIMATE_ITEM_DECORATIONS
-- ────────────────────────────────────────────────────────────
create table public.estimate_item_decorations (
  id               uuid primary key default uuid_generate_v4(),
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  sort_order       integer not null default 0,
  kind             text not null check (kind in ('art','numbers','names','outside_deco')),
  position         text,          -- Front Center, Back Center, etc.

  -- art fields
  art_file_id      uuid references public.art_files(id) on delete set null,
  art_tbd_type     text,          -- screen_print | embroidery | heat_press | dtf
  tbd_colors       integer,
  tbd_stitches     integer,
  tbd_dtf_size     integer,
  underbase        boolean default false,

  -- numbers fields
  num_method       text,          -- heat_transfer | screen_print | embroidery
  num_size         text,
  two_color        boolean default false,
  roster           jsonb,         -- {"23":"Smith","42":"Johnson"}
  custom_font_art_id uuid references public.art_files(id) on delete set null,

  -- names fields
  sell_each        numeric(10,2),
  cost_each        numeric(10,2),
  names_list       jsonb,         -- {"0":"Smith","1":"Jones"}

  -- outside_deco fields
  vendor           text,
  deco_type        text,
  notes            text,

  -- shared
  sell_override    numeric(10,2),
  created_at       timestamptz not null default now()
);

create index idx_est_item_deco_item on public.estimate_item_decorations(estimate_item_id);

-- ────────────────────────────────────────────────────────────
-- 16. ESTIMATE_ART_FILES  (many-to-many)
-- ────────────────────────────────────────────────────────────
create table public.estimate_art_files (
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  art_file_id uuid not null references public.art_files(id) on delete cascade,
  primary key (estimate_id, art_file_id)
);

-- ────────────────────────────────────────────────────────────
-- 17. SALES_ORDERS
-- ────────────────────────────────────────────────────────────
create table public.sales_orders (
  id                uuid primary key default uuid_generate_v4(),
  display_id        text not null unique,        -- SO-1042
  customer_id       uuid not null references public.customers(id) on delete cascade,
  estimate_id       uuid references public.estimates(id) on delete set null,
  memo              text,
  status            text not null default 'need_order' check (status in (
                      'need_order','waiting_receive','items_received',
                      'in_production','ready_to_invoice','complete'
                    )),
  expected_date     date,
  production_notes  text,
  shipping_type     text check (shipping_type in ('flat','pct')),
  shipping_value    numeric(10,2) default 0,
  ship_to_id        text,
  omg_store_id      text,
  created_by        uuid references public.user_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger trg_sales_orders_updated
  before update on public.sales_orders
  for each row execute function public.set_updated_at();

create index idx_so_customer  on public.sales_orders(customer_id);
create index idx_so_status    on public.sales_orders(status);
create index idx_so_estimate  on public.sales_orders(estimate_id);

-- ────────────────────────────────────────────────────────────
-- 18. SALES_ORDER_ITEMS
-- ────────────────────────────────────────────────────────────
create table public.sales_order_items (
  id            uuid primary key default uuid_generate_v4(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  sort_order    integer not null default 0,
  product_id    uuid references public.products(id) on delete set null,
  sku           text,
  name          text,
  brand         text,
  color         text,
  nsa_cost      numeric(10,2),
  retail_price  numeric(10,2),
  unit_sell     numeric(10,2),
  sizes         jsonb not null default '{}',      -- {"S":5,"M":20,"L":15}
  no_deco       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_so_items_so on public.sales_order_items(sales_order_id);

-- ────────────────────────────────────────────────────────────
-- 19. SALES_ORDER_ITEM_DECORATIONS
-- ────────────────────────────────────────────────────────────
create table public.sales_order_item_decorations (
  id               uuid primary key default uuid_generate_v4(),
  so_item_id       uuid not null references public.sales_order_items(id) on delete cascade,
  sort_order       integer not null default 0,
  kind             text not null check (kind in ('art','numbers','names','outside_deco')),
  position         text,

  -- art fields
  art_file_id      uuid references public.art_files(id) on delete set null,
  art_tbd_type     text,
  tbd_colors       integer,
  tbd_stitches     integer,
  tbd_dtf_size     integer,
  underbase        boolean default false,

  -- numbers fields
  num_method       text,
  num_size         text,
  two_color        boolean default false,
  roster           jsonb,
  custom_font_art_id uuid references public.art_files(id) on delete set null,

  -- names fields
  sell_each        numeric(10,2),
  cost_each        numeric(10,2),
  names_list       jsonb,

  -- outside_deco fields
  vendor           text,
  deco_type        text,
  notes            text,

  -- shared
  sell_override    numeric(10,2),
  created_at       timestamptz not null default now()
);

create index idx_so_item_deco_item on public.sales_order_item_decorations(so_item_id);

-- ────────────────────────────────────────────────────────────
-- 20. SALES_ORDER_ART_FILES  (many-to-many)
-- ────────────────────────────────────────────────────────────
create table public.sales_order_art_files (
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  art_file_id    uuid not null references public.art_files(id) on delete cascade,
  primary key (sales_order_id, art_file_id)
);

-- ────────────────────────────────────────────────────────────
-- 21. FIRM_DATES  (per sales order)
-- ────────────────────────────────────────────────────────────
create table public.firm_dates (
  id              uuid primary key default uuid_generate_v4(),
  sales_order_id  uuid not null references public.sales_orders(id) on delete cascade,
  item_desc       text,
  firm_date       date not null,
  approved        boolean not null default false,
  requested_by    uuid references public.user_profiles(id) on delete set null,
  requested_at    timestamptz not null default now(),
  note            text
);

create index idx_firm_dates_so on public.firm_dates(sales_order_id);

-- ────────────────────────────────────────────────────────────
-- 22. PICK_LINES  (internal fulfillment pulls)
-- ────────────────────────────────────────────────────────────
create table public.pick_lines (
  id            uuid primary key default uuid_generate_v4(),
  display_id    text not null unique,            -- IF-1001
  so_item_id    uuid not null references public.sales_order_items(id) on delete cascade,
  sizes         jsonb not null default '{}',     -- {"S":5,"M":10}
  status        text not null default 'pick' check (status in ('pick','pulled')),
  memo          text,
  ship_dest     text,                            -- in_house | ship_customer | vendor name
  ship_addr     text,
  deco_vendor   text,
  created_at    timestamptz not null default now()
);

create index idx_pick_lines_item on public.pick_lines(so_item_id);

-- ────────────────────────────────────────────────────────────
-- 23. PO_LINES  (vendor purchase orders per SO item)
-- ────────────────────────────────────────────────────────────
create table public.po_lines (
  id            uuid primary key default uuid_generate_v4(),
  display_id    text not null unique,            -- PO-3001
  so_item_id    uuid not null references public.sales_order_items(id) on delete cascade,
  sizes         jsonb not null default '{}',     -- {"S":2,"M":6}
  received      jsonb not null default '{}',     -- partial receipt
  cancelled     jsonb not null default '{}',
  status        text not null default 'waiting' check (status in ('waiting','partial','received')),
  memo          text,
  created_at    timestamptz not null default now()
);

create index idx_po_lines_item on public.po_lines(so_item_id);

-- ────────────────────────────────────────────────────────────
-- 24. PO_SHIPMENTS  (receiving log for PO lines)
-- ────────────────────────────────────────────────────────────
create table public.po_shipments (
  id          uuid primary key default uuid_generate_v4(),
  po_line_id  uuid not null references public.po_lines(id) on delete cascade,
  sizes       jsonb not null default '{}',       -- {"S":2,"M":4}
  received_at timestamptz not null default now()
);

create index idx_po_shipments_po on public.po_shipments(po_line_id);

-- ────────────────────────────────────────────────────────────
-- 25. PRODUCTION_JOBS
-- ────────────────────────────────────────────────────────────
create table public.production_jobs (
  id               uuid primary key default uuid_generate_v4(),
  display_id       text not null unique,         -- JOB-1042-01
  sales_order_id   uuid not null references public.sales_orders(id) on delete cascade,
  art_file_id      uuid references public.art_files(id) on delete set null,
  art_name         text,
  deco_type        text,
  positions        text,                         -- "Front Center, Left Chest"

  art_status       text not null default 'needs_art' check (art_status in (
                     'needs_art','waiting_approval','art_complete'
                   )),
  item_status      text not null default 'need_to_order' check (item_status in (
                     'need_to_order','partially_received','items_received'
                   )),
  prod_status      text not null default 'hold' check (prod_status in (
                     'hold','staging','in_process','completed','shipped'
                   )),

  total_units      integer not null default 0,
  fulfilled_units  integer not null default 0,
  split_from       uuid references public.production_jobs(id) on delete set null,

  assigned_machine text,
  assigned_to      text,
  ship_method      text,                         -- rep_delivery | ship_customer | ship_warehouse

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_production_jobs_updated
  before update on public.production_jobs
  for each row execute function public.set_updated_at();

create index idx_jobs_so     on public.production_jobs(sales_order_id);
create index idx_jobs_status on public.production_jobs(prod_status);

-- ────────────────────────────────────────────────────────────
-- 26. PRODUCTION_JOB_ITEMS  (links job → SO items)
-- ────────────────────────────────────────────────────────────
create table public.production_job_items (
  id            uuid primary key default uuid_generate_v4(),
  job_id        uuid not null references public.production_jobs(id) on delete cascade,
  so_item_id    uuid not null references public.sales_order_items(id) on delete cascade,
  deco_index    integer not null default 0,      -- which decoration on the SO item
  sku           text,
  name          text,
  color         text,
  units         integer not null default 0,
  fulfilled     integer not null default 0
);

create index idx_job_items_job on public.production_job_items(job_id);

-- ────────────────────────────────────────────────────────────
-- 27. INVOICES
-- ────────────────────────────────────────────────────────────
create table public.invoices (
  id            uuid primary key default uuid_generate_v4(),
  display_id    text not null unique,            -- INV-5001
  customer_id   uuid not null references public.customers(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  memo          text,
  invoice_date  date not null default current_date,
  due_date      date,
  subtotal      numeric(10,2) not null default 0,
  tax           numeric(10,2) not null default 0,
  shipping      numeric(10,2) not null default 0,
  cc_fee        numeric(10,2) not null default 0,
  total         numeric(10,2) not null default 0,
  paid          numeric(10,2) not null default 0,
  status        text not null default 'open' check (status in (
                  'open','partial','paid','overdue','void'
                )),
  qb_invoice_id text,
  created_by    uuid references public.user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger trg_invoices_updated
  before update on public.invoices
  for each row execute function public.set_updated_at();

create index idx_invoices_customer on public.invoices(customer_id);
create index idx_invoices_so       on public.invoices(sales_order_id);
create index idx_invoices_status   on public.invoices(status);

-- ────────────────────────────────────────────────────────────
-- 28. INVOICE_PAYMENTS
-- ────────────────────────────────────────────────────────────
create table public.invoice_payments (
  id          uuid primary key default uuid_generate_v4(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  amount      numeric(10,2) not null,
  method      text not null check (method in ('cc','check','venmo','bank_transfer','cash')),
  reference   text,              -- check # / transaction ref
  paid_at     timestamptz not null default now()
);

create index idx_inv_payments_inv on public.invoice_payments(invoice_id);

-- ────────────────────────────────────────────────────────────
-- 29. MESSAGES  (per-SO collaboration thread)
-- ────────────────────────────────────────────────────────────
create table public.messages (
  id          uuid primary key default uuid_generate_v4(),
  so_id       uuid not null references public.sales_orders(id) on delete cascade,
  author_id   uuid references public.user_profiles(id) on delete set null,
  dept        text not null default 'all' check (dept in (
                'all','art','production','warehouse','sales','accounting'
              )),
  body        text not null,
  created_at  timestamptz not null default now()
);

create index idx_messages_so on public.messages(so_id);

-- ────────────────────────────────────────────────────────────
-- 30. MESSAGE_READS  (track who read what)
-- ────────────────────────────────────────────────────────────
create table public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- ────────────────────────────────────────────────────────────
-- 31. BATCH_POS  (vendor order batching)
-- ────────────────────────────────────────────────────────────
create table public.batch_pos (
  id              uuid primary key default uuid_generate_v4(),
  display_id      text not null unique,          -- BPO-{timestamp}
  vendor_id       uuid references public.vendors(id) on delete set null,
  vendor_name     text,
  sales_order_id  uuid references public.sales_orders(id) on delete set null,
  so_memo         text,
  customer_name   text,
  total_cost      numeric(10,2) not null default 0,
  status          text not null default 'pending' check (status in (
                    'pending','submitted','received'
                  )),
  created_by      uuid references public.user_profiles(id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now()
);

create index idx_batch_pos_vendor on public.batch_pos(vendor_id);
create index idx_batch_pos_status on public.batch_pos(status);

-- ────────────────────────────────────────────────────────────
-- 32. BATCH_PO_ITEMS
-- ────────────────────────────────────────────────────────────
create table public.batch_po_items (
  id          uuid primary key default uuid_generate_v4(),
  batch_po_id uuid not null references public.batch_pos(id) on delete cascade,
  so_item_id  uuid references public.sales_order_items(id) on delete set null,
  sku         text,
  name        text,
  color       text,
  sizes       jsonb not null default '{}',       -- {"S":2,"M":6}
  qty         integer not null default 0,
  unit_cost   numeric(10,2)
);

create index idx_batch_po_items_bpo on public.batch_po_items(batch_po_id);

-- ────────────────────────────────────────────────────────────
-- 33. OMG_STORES  (team fundraiser stores)
-- ────────────────────────────────────────────────────────────
create table public.omg_stores (
  id              uuid primary key default uuid_generate_v4(),
  display_id      text not null unique,          -- OMG-1001
  store_name      text not null,
  customer_id     uuid references public.customers(id) on delete set null,
  rep_id          uuid references public.user_profiles(id) on delete set null,
  status          text not null default 'draft' check (status in ('draft','open','closed')),
  open_date       date,
  close_date      date,
  orders          integer not null default 0,
  total_sales     numeric(10,2) not null default 0,
  fundraise_total numeric(10,2) not null default 0,
  items_sold      integer not null default 0,
  unique_buyers   integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_omg_stores_updated
  before update on public.omg_stores
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 34. OMG_STORE_PRODUCTS
-- ────────────────────────────────────────────────────────────
create table public.omg_store_products (
  id            uuid primary key default uuid_generate_v4(),
  store_id      uuid not null references public.omg_stores(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  sku           text,
  name          text,
  color         text,
  retail_price  numeric(10,2),
  nsa_cost      numeric(10,2),
  deco_type     text,
  deco_cost     numeric(10,2),
  sizes_sold    jsonb not null default '{}'       -- {"S":3,"M":7}
);

create index idx_omg_products_store on public.omg_store_products(store_id);

-- ────────────────────────────────────────────────────────────
-- 35. FAVORITE_SKUS  (per user)
-- ────────────────────────────────────────────────────────────
create table public.favorite_skus (
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ────────────────────────────────────────────────────────────
-- 36. COMMISSION_OVERRIDES  (admin approves full rate on late invoices)
--     Sensitive — GM must NOT have access, only admin + the rep
-- ────────────────────────────────────────────────────────────
create table public.commission_overrides (
  id          uuid primary key default uuid_generate_v4(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  rep_id      uuid not null references public.user_profiles(id) on delete cascade,
  override_rate numeric(4,2) not null default 0.30,  -- restored commission rate
  approved_by uuid not null references public.user_profiles(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  unique (invoice_id, rep_id)
);

create index idx_comm_overrides_rep on public.commission_overrides(rep_id);
create index idx_comm_overrides_inv on public.commission_overrides(invoice_id);

-- ────────────────────────────────────────────────────────────
-- 37. SEQUENCE COUNTERS  (for display_id generation)
-- ────────────────────────────────────────────────────────────
create table public.id_sequences (
  entity    text primary key,   -- estimates | sales_orders | invoices | etc.
  next_val  integer not null default 1
);

-- Function to get next display ID
create or replace function public.next_display_id(p_entity text, p_prefix text)
returns text as $$
declare
  v_val integer;
begin
  update public.id_sequences
    set next_val = next_val + 1
    where entity = p_entity
    returning next_val - 1 into v_val;

  if v_val is null then
    insert into public.id_sequences (entity, next_val) values (p_entity, 2);
    v_val := 1;
  end if;

  return p_prefix || '-' || v_val;
end;
$$ language plpgsql;

-- ────────────────────────────────────────────────────────────
-- 38. SALES REPORTING VIEW (role-scoped)
--     Admin sees all reps. Reps see only their own data.
--     GM sees all reps (operational, not commission).
-- ────────────────────────────────────────────────────────────
create or replace function public.get_sales_report(
  p_start_date date default (current_date - interval '30 days')::date,
  p_end_date   date default current_date
)
returns table (
  rep_id        uuid,
  rep_name      text,
  total_revenue numeric,
  total_cost    numeric,
  gross_profit  numeric,
  gp_pct        numeric,
  invoice_count bigint,
  so_count      bigint,
  estimate_count bigint,
  avg_order_value numeric
) as $$
declare
  v_role text;
  v_profile_id uuid;
begin
  select up.role, up.id
    into v_role, v_profile_id
    from public.user_profiles up
    where up.auth_id = auth.uid();

  return query
    select
      u.id                                          as rep_id,
      u.full_name                                   as rep_name,
      coalesce(sum(i.total), 0)                     as total_revenue,
      0::numeric                                    as total_cost,  -- computed at app layer
      0::numeric                                    as gross_profit,
      0::numeric                                    as gp_pct,
      count(distinct i.id)                          as invoice_count,
      count(distinct so.id)                         as so_count,
      count(distinct e.id)                          as estimate_count,
      case when count(distinct i.id) > 0
        then round(coalesce(sum(i.total), 0) / count(distinct i.id), 2)
        else 0 end                                  as avg_order_value
    from public.user_profiles u
    left join public.sales_orders so
      on so.created_by = u.id
      and so.created_at::date between p_start_date and p_end_date
    left join public.invoices i
      on i.sales_order_id = so.id
      and i.invoice_date between p_start_date and p_end_date
    left join public.estimates e
      on e.created_by = u.id
      and e.created_at::date between p_start_date and p_end_date
    where u.role in ('rep', 'admin')
      -- Reps can only see their own row
      and (v_role in ('admin', 'gm') or u.id = v_profile_id)
    group by u.id, u.full_name
    order by coalesce(sum(i.total), 0) desc;
end;
$$ language plpgsql security definer stable;
