-- ============================================================
-- NSA Portal – App Schema Alignment
-- Migration: 00007_app_schema_alignment
--
-- The migrations 00001-00006 created a "normalized" schema with
-- UUID primary keys and table names like sales_order_items,
-- production_jobs, etc. However, App.js was built against a
-- simpler schema with TEXT primary keys and table names like
-- so_items, so_jobs, team_members, etc.
--
-- This migration drops the incompatible normalized tables and
-- creates the correct schema that App.js expects.
-- ============================================================

-- ─── STEP 1: Preserve data we need ──────────────────────────

-- Save customer data (user may have created customers already)
CREATE TEMP TABLE IF NOT EXISTS _save_customers AS
  SELECT id::TEXT as id, parent_id::TEXT as parent_id, name, alpha_tag,
         billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip,
         shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip,
         pricing_tier as adidas_ua_tier, catalog_markup,
         payment_terms, tax_rate, tax_exempt, primary_rep_id::TEXT as primary_rep_id,
         notes, is_active, created_at, updated_at
  FROM public.customers;

CREATE TEMP TABLE IF NOT EXISTS _save_contacts AS
  SELECT id, customer_id::TEXT as customer_id, name, email, phone, role
  FROM public.customer_contacts;

-- Save user_profiles for team_members seeding
CREATE TEMP TABLE IF NOT EXISTS _save_profiles AS
  SELECT id::TEXT as id, full_name as name, role, email, pin as phone, is_active
  FROM public.user_profiles;

-- Save decoration_types and price_matrix (reference data from seed)
CREATE TEMP TABLE IF NOT EXISTS _save_deco_types AS SELECT * FROM public.decoration_types;
CREATE TEMP TABLE IF NOT EXISTS _save_price_matrix AS SELECT * FROM public.price_matrix;

-- Save id_sequences
CREATE TEMP TABLE IF NOT EXISTS _save_id_sequences AS SELECT * FROM public.id_sequences;

-- Save app_settings (Slack config)
CREATE TEMP TABLE IF NOT EXISTS _save_app_settings AS SELECT * FROM public.app_settings;


-- ─── STEP 2: Drop ALL conflicting tables ────────────────────
-- Drop in reverse dependency order to avoid FK violations

-- Slack/notification tables (reference both user_profiles and messages)
DROP TABLE IF EXISTS public.slack_notifications CASCADE;
DROP TABLE IF EXISTS public.notification_preferences CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

-- Commission / favorites
DROP TABLE IF EXISTS public.commission_overrides CASCADE;
DROP TABLE IF EXISTS public.favorite_skus CASCADE;

-- Batch POs
DROP TABLE IF EXISTS public.batch_po_items CASCADE;
DROP TABLE IF EXISTS public.batch_pos CASCADE;

-- OMG stores
DROP TABLE IF EXISTS public.omg_store_products CASCADE;
DROP TABLE IF EXISTS public.omg_stores CASCADE;

-- Messages
DROP TABLE IF EXISTS public.message_reads CASCADE;
DROP TABLE IF EXISTS public.messages CASCADE;

-- Invoices
DROP TABLE IF EXISTS public.invoice_payments CASCADE;
DROP TABLE IF EXISTS public.invoices CASCADE;

-- Production
DROP TABLE IF EXISTS public.production_job_items CASCADE;
DROP TABLE IF EXISTS public.production_jobs CASCADE;

-- Fulfillment
DROP TABLE IF EXISTS public.po_shipments CASCADE;
DROP TABLE IF EXISTS public.po_lines CASCADE;
DROP TABLE IF EXISTS public.pick_lines CASCADE;

-- Sales orders
DROP TABLE IF EXISTS public.firm_dates CASCADE;
DROP TABLE IF EXISTS public.sales_order_art_files CASCADE;
DROP TABLE IF EXISTS public.sales_order_item_decorations CASCADE;
DROP TABLE IF EXISTS public.sales_order_items CASCADE;
DROP TABLE IF EXISTS public.sales_orders CASCADE;

-- Estimates
DROP TABLE IF EXISTS public.estimate_art_files CASCADE;
DROP TABLE IF EXISTS public.estimate_item_decorations CASCADE;
DROP TABLE IF EXISTS public.estimate_items CASCADE;
DROP TABLE IF EXISTS public.estimates CASCADE;

-- Reference data
DROP TABLE IF EXISTS public.price_matrix CASCADE;
DROP TABLE IF EXISTS public.decoration_types CASCADE;
DROP TABLE IF EXISTS public.art_files CASCADE;

-- Products / inventory
DROP TABLE IF EXISTS public.inventory_adjustments CASCADE;
DROP TABLE IF EXISTS public.inventory CASCADE;
DROP TABLE IF EXISTS public.product_variants CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;

-- Vendors
DROP TABLE IF EXISTS public.vendors CASCADE;

-- Customers
DROP TABLE IF EXISTS public.customer_contacts CASCADE;
DROP TABLE IF EXISTS public.customers CASCADE;

-- Sequences
DROP TABLE IF EXISTS public.id_sequences CASCADE;

-- NOTE: user_profiles is KEPT for auth.uid() RLS helper functions


-- ─── STEP 3: Create tables matching App.js ──────────────────

CREATE TABLE public.team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.customers (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  alpha_tag TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  shipping_address_line1 TEXT,
  shipping_address_line2 TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_zip TEXT,
  adidas_ua_tier TEXT DEFAULT 'B',
  catalog_markup NUMERIC DEFAULT 1.65,
  payment_terms TEXT DEFAULT 'net30',
  tax_rate NUMERIC,
  tax_exempt BOOLEAN DEFAULT false,
  primary_rep_id TEXT REFERENCES public.team_members(id),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_customers_parent ON public.customers(parent_id);
CREATE INDEX idx_customers_rep ON public.customers(primary_rep_id);

CREATE TABLE public.customer_contacts (
  id SERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  sort_order INT DEFAULT 0
);
CREATE INDEX idx_customer_contacts_cust ON public.customer_contacts(customer_id);

CREATE TABLE public.vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor_type TEXT DEFAULT 'upload',
  api_provider TEXT,
  nsa_carries_inventory BOOLEAN DEFAULT false,
  click_automation BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  contact_email TEXT,
  contact_phone TEXT,
  rep_name TEXT,
  payment_terms TEXT DEFAULT 'net30',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.products (
  id TEXT PRIMARY KEY,
  vendor_id TEXT REFERENCES public.vendors(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  brand TEXT,
  color TEXT,
  category TEXT,
  retail_price NUMERIC,
  nsa_cost NUMERIC,
  is_active BOOLEAN DEFAULT true,
  available_sizes JSONB DEFAULT '[]',
  _colors JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_products_vendor ON public.products(vendor_id);
CREATE INDEX idx_products_sku ON public.products(sku);

CREATE TABLE public.product_inventory (
  id SERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  quantity INT DEFAULT 0,
  alert_threshold INT,
  UNIQUE(product_id, size)
);
CREATE INDEX idx_product_inv_product ON public.product_inventory(product_id);

-- ─── ESTIMATES ───

CREATE TABLE public.estimates (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES public.customers(id),
  memo TEXT,
  status TEXT DEFAULT 'draft',
  created_by TEXT REFERENCES public.team_members(id),
  created_at TEXT,
  updated_at TEXT,
  default_markup NUMERIC DEFAULT 1.65,
  shipping_type TEXT,
  shipping_value NUMERIC DEFAULT 0,
  ship_to_id TEXT DEFAULT 'default',
  email_status TEXT,
  email_opened_at TEXT,
  email_viewed_at TEXT,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_estimates_customer ON public.estimates(customer_id);
CREATE INDEX idx_estimates_status ON public.estimates(status);

CREATE TABLE public.estimate_art_files (
  id TEXT NOT NULL,
  estimate_id TEXT NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  name TEXT,
  deco_type TEXT,
  ink_colors TEXT,
  thread_colors TEXT,
  art_size TEXT,
  files JSONB DEFAULT '[]',
  mockup_files JSONB DEFAULT '[]',
  prod_files JSONB DEFAULT '[]',
  notes TEXT,
  status TEXT DEFAULT 'needs_art',
  uploaded TEXT,
  PRIMARY KEY (estimate_id, id)
);

CREATE TABLE public.estimate_items (
  id SERIAL PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  item_index INT NOT NULL,
  product_id TEXT REFERENCES public.products(id),
  sku TEXT,
  name TEXT,
  brand TEXT,
  color TEXT,
  nsa_cost NUMERIC,
  retail_price NUMERIC,
  unit_sell NUMERIC,
  sizes JSONB DEFAULT '{}',
  available_sizes JSONB DEFAULT '[]',
  _colors JSONB,
  no_deco BOOLEAN DEFAULT false,
  is_custom BOOLEAN DEFAULT false,
  custom_desc TEXT,
  custom_cost NUMERIC,
  custom_sell NUMERIC
);
CREATE INDEX idx_estimate_items_est ON public.estimate_items(estimate_id);

CREATE TABLE public.estimate_item_decorations (
  id SERIAL PRIMARY KEY,
  estimate_item_id INT NOT NULL REFERENCES public.estimate_items(id) ON DELETE CASCADE,
  deco_index INT NOT NULL,
  kind TEXT,
  position TEXT,
  type TEXT,
  art_file_id TEXT,
  art_tbd_type TEXT,
  tbd_colors INT,
  tbd_stitches INT,
  tbd_dtf_size INT,
  sell_override NUMERIC,
  sell_each NUMERIC,
  cost_each NUMERIC,
  underbase BOOLEAN DEFAULT false,
  two_color BOOLEAN DEFAULT false,
  colors INT,
  stitches INT,
  dtf_size INT,
  num_method TEXT,
  num_size TEXT,
  roster JSONB,
  names JSONB,
  names_list JSONB,
  vendor TEXT,
  deco_type TEXT,
  notes TEXT,
  custom_font_art_id TEXT,
  _showRoster BOOLEAN DEFAULT false
);
CREATE INDEX idx_est_item_decos_item ON public.estimate_item_decorations(estimate_item_id);

-- ─── SALES ORDERS ───

CREATE TABLE public.sales_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES public.customers(id),
  estimate_id TEXT REFERENCES public.estimates(id) ON DELETE SET NULL,
  memo TEXT,
  status TEXT DEFAULT 'need_order',
  created_by TEXT REFERENCES public.team_members(id),
  created_at TEXT,
  updated_at TEXT,
  expected_date TEXT,
  production_notes TEXT,
  shipping_type TEXT,
  shipping_value NUMERIC DEFAULT 0,
  ship_to_id TEXT DEFAULT 'default',
  default_markup NUMERIC DEFAULT 1.65,
  omg_store_id TEXT,
  _shipstation_order_id TEXT,
  _shipping_status TEXT,
  _tracking_number TEXT,
  _carrier TEXT,
  _ship_date TEXT,
  _tracking_url TEXT,
  _shipped BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_so_customer ON public.sales_orders(customer_id);
CREATE INDEX idx_so_status ON public.sales_orders(status);
CREATE INDEX idx_so_estimate ON public.sales_orders(estimate_id);

CREATE TABLE public.so_art_files (
  id TEXT NOT NULL,
  so_id TEXT NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  name TEXT,
  deco_type TEXT,
  ink_colors TEXT,
  thread_colors TEXT,
  art_size TEXT,
  files JSONB DEFAULT '[]',
  mockup_files JSONB DEFAULT '[]',
  prod_files JSONB DEFAULT '[]',
  notes TEXT,
  status TEXT DEFAULT 'needs_art',
  uploaded TEXT,
  PRIMARY KEY (so_id, id)
);

CREATE TABLE public.so_firm_dates (
  id SERIAL PRIMARY KEY,
  so_id TEXT NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  item_desc TEXT,
  date TEXT,
  approved BOOLEAN DEFAULT false
);
CREATE INDEX idx_so_firm_dates_so ON public.so_firm_dates(so_id);

CREATE TABLE public.so_items (
  id SERIAL PRIMARY KEY,
  so_id TEXT NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  item_index INT NOT NULL,
  product_id TEXT REFERENCES public.products(id),
  sku TEXT,
  name TEXT,
  brand TEXT,
  color TEXT,
  nsa_cost NUMERIC,
  retail_price NUMERIC,
  unit_sell NUMERIC,
  sizes JSONB DEFAULT '{}',
  available_sizes JSONB DEFAULT '[]',
  _colors JSONB,
  no_deco BOOLEAN DEFAULT false,
  is_custom BOOLEAN DEFAULT false,
  custom_desc TEXT,
  custom_cost NUMERIC,
  custom_sell NUMERIC
);
CREATE INDEX idx_so_items_so ON public.so_items(so_id);

CREATE TABLE public.so_item_decorations (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES public.so_items(id) ON DELETE CASCADE,
  deco_index INT NOT NULL,
  kind TEXT,
  position TEXT,
  type TEXT,
  art_file_id TEXT,
  art_tbd_type TEXT,
  tbd_colors INT,
  tbd_stitches INT,
  tbd_dtf_size INT,
  sell_override NUMERIC,
  sell_each NUMERIC,
  cost_each NUMERIC,
  underbase BOOLEAN DEFAULT false,
  two_color BOOLEAN DEFAULT false,
  colors INT,
  stitches INT,
  dtf_size INT,
  num_method TEXT,
  num_size TEXT,
  roster JSONB,
  names JSONB,
  names_list JSONB,
  vendor TEXT,
  deco_type TEXT,
  notes TEXT,
  custom_font_art_id TEXT,
  _showRoster BOOLEAN DEFAULT false
);
CREATE INDEX idx_so_item_decos_item ON public.so_item_decorations(so_item_id);

CREATE TABLE public.so_item_pick_lines (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES public.so_items(id) ON DELETE CASCADE,
  pick_id TEXT,
  sizes JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pick',
  created_at TEXT,
  memo TEXT,
  ship_dest TEXT DEFAULT 'in_house',
  ship_addr TEXT,
  deco_vendor TEXT
);
CREATE INDEX idx_so_picks_item ON public.so_item_pick_lines(so_item_id);

CREATE TABLE public.so_item_po_lines (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES public.so_items(id) ON DELETE CASCADE,
  po_id TEXT,
  vendor TEXT,
  sizes JSONB DEFAULT '{}',
  received JSONB DEFAULT '{}',
  cancelled JSONB DEFAULT '{}',
  shipments JSONB DEFAULT '[]',
  status TEXT DEFAULT 'ordered',
  created_at TEXT,
  expected_date TEXT,
  memo TEXT
);
CREATE INDEX idx_so_pos_item ON public.so_item_po_lines(so_item_id);

CREATE TABLE public.so_jobs (
  id TEXT NOT NULL,
  so_id TEXT NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  key TEXT,
  art_file_id TEXT,
  art_name TEXT,
  deco_type TEXT,
  positions TEXT,
  art_status TEXT DEFAULT 'needs_art',
  item_status TEXT DEFAULT 'need_to_order',
  prod_status TEXT DEFAULT 'hold',
  total_units INT DEFAULT 0,
  fulfilled_units INT DEFAULT 0,
  split_from TEXT,
  created_at TEXT,
  assigned_machine TEXT,
  assigned_to TEXT,
  ship_method TEXT,
  items JSONB DEFAULT '[]',
  _auto BOOLEAN DEFAULT false,
  PRIMARY KEY (so_id, id)
);
CREATE INDEX idx_so_jobs_so ON public.so_jobs(so_id);

-- ─── INVOICES ───

CREATE TABLE public.invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES public.customers(id),
  so_id TEXT REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'invoice',
  date TEXT,
  due_date TEXT,
  total NUMERIC DEFAULT 0,
  paid NUMERIC DEFAULT 0,
  memo TEXT,
  status TEXT DEFAULT 'open',
  cc_fee NUMERIC DEFAULT 0,
  created_by TEXT REFERENCES public.team_members(id),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX idx_invoices_so ON public.invoices(so_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);

CREATE TABLE public.invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC,
  method TEXT,
  ref TEXT,
  date TEXT
);
CREATE INDEX idx_inv_payments_inv ON public.invoice_payments(invoice_id);

CREATE TABLE public.invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  qty INT,
  unit_price NUMERIC,
  total NUMERIC,
  description TEXT
);
CREATE INDEX idx_inv_items_inv ON public.invoice_items(invoice_id);

-- ─── MESSAGES ───

CREATE TABLE public.messages (
  id TEXT PRIMARY KEY,
  so_id TEXT REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES public.customers(id),
  author_id TEXT REFERENCES public.team_members(id),
  author TEXT,
  dept TEXT,
  text TEXT,
  ts TEXT,
  priority TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_so ON public.messages(so_id);

CREATE TABLE public.message_reads (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.team_members(id),
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);
CREATE INDEX idx_msg_reads_msg ON public.message_reads(message_id);
CREATE INDEX idx_msg_reads_user ON public.message_reads(user_id);

-- ─── OMG STORES ───

CREATE TABLE public.omg_stores (
  id TEXT PRIMARY KEY,
  store_name TEXT,
  customer_id TEXT REFERENCES public.customers(id),
  rep_id TEXT REFERENCES public.team_members(id),
  status TEXT DEFAULT 'draft',
  open_date TEXT,
  close_date TEXT,
  orders INT DEFAULT 0,
  total_sales NUMERIC DEFAULT 0,
  fundraise_total NUMERIC DEFAULT 0,
  items_sold INT DEFAULT 0,
  unique_buyers INT DEFAULT 0,
  _omg_source BOOLEAN DEFAULT false,
  _omg_id TEXT,
  _last_synced TEXT
);
CREATE INDEX idx_omg_customer ON public.omg_stores(customer_id);

CREATE TABLE public.omg_store_products (
  id SERIAL PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES public.omg_stores(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  color TEXT,
  retail NUMERIC,
  cost NUMERIC,
  deco_type TEXT,
  deco_cost NUMERIC,
  sizes JSONB DEFAULT '{}'
);
CREATE INDEX idx_omg_products_store ON public.omg_store_products(store_id);

-- ─── ISSUES ───

CREATE TABLE public.issues (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'open',
  description TEXT,
  priority TEXT DEFAULT 'medium',
  page TEXT,
  viewing TEXT,
  reported_by TEXT,
  role TEXT,
  timestamp TEXT,
  recent_errors JSONB DEFAULT '[]',
  resolved_at TEXT,
  resolution TEXT
);

-- ─── APP STATE (key-value store) ───

CREATE TABLE public.app_state (
  id TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─── ID SEQUENCES (for display IDs) ───

CREATE TABLE public.id_sequences (
  entity TEXT PRIMARY KEY,
  next_val INTEGER NOT NULL DEFAULT 1
);

-- ─── DECORATION TYPES (reference data) ───

CREATE TABLE public.decoration_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ─── PRICE MATRIX ───

CREATE TABLE public.price_matrix (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decoration_type_id UUID NOT NULL REFERENCES public.decoration_types(id) ON DELETE CASCADE,
  tier_name TEXT NOT NULL,
  tier_sort INTEGER NOT NULL DEFAULT 0,
  qty_min INTEGER NOT NULL,
  qty_max INTEGER,
  price_per_piece NUMERIC(10,4) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_matrix_deco ON public.price_matrix(decoration_type_id);


-- ─── STEP 4: Migrate saved data ─────────────────────────────

-- Seed team_members from user_profiles
INSERT INTO public.team_members (id, name, role, email, phone, is_active)
SELECT id, name, role, null, phone, is_active FROM _save_profiles
ON CONFLICT (id) DO NOTHING;

-- Restore customers
INSERT INTO public.customers (id, parent_id, name, alpha_tag,
  billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip,
  shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip,
  adidas_ua_tier, catalog_markup, payment_terms, tax_rate, tax_exempt, primary_rep_id, notes, is_active,
  created_at, updated_at)
SELECT id, parent_id, name, alpha_tag,
  billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip,
  shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip,
  adidas_ua_tier, catalog_markup, payment_terms, tax_rate, tax_exempt, primary_rep_id, notes, is_active,
  created_at, updated_at
FROM _save_customers
ON CONFLICT (id) DO NOTHING;

-- Restore customer contacts
INSERT INTO public.customer_contacts (customer_id, name, email, phone, role, sort_order)
SELECT customer_id, name, email, phone, role, 0
FROM _save_contacts
WHERE customer_id IN (SELECT id FROM public.customers)
ON CONFLICT DO NOTHING;

-- Restore decoration_types
INSERT INTO public.decoration_types (id, name, code, is_active)
SELECT id, name, code, is_active FROM _save_deco_types
ON CONFLICT (id) DO NOTHING;

-- Restore price_matrix
INSERT INTO public.price_matrix (id, decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece, created_at, updated_at)
SELECT id, decoration_type_id, tier_name, tier_sort, qty_min, qty_max, price_per_piece, created_at, updated_at
FROM _save_price_matrix
WHERE decoration_type_id IN (SELECT id FROM public.decoration_types)
ON CONFLICT (id) DO NOTHING;

-- Restore id_sequences
INSERT INTO public.id_sequences (entity, next_val)
SELECT entity, next_val FROM _save_id_sequences
ON CONFLICT (entity) DO NOTHING;

-- Restore app_settings (recreate table first)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value, updated_at)
SELECT key, value, updated_at FROM _save_app_settings
ON CONFLICT (key) DO NOTHING;


-- ─── STEP 5: Enable Realtime ─────────────────────────────────

DO $$
BEGIN
  -- Try to add tables to realtime publication (ignore errors if already added or publication doesn't exist)
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.estimates; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_orders; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.issues; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_items; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_pick_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.so_item_po_lines; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;


-- ─── STEP 6: Row Level Security ─────────────────────────────
-- The app uses anon key, so policies must allow anon access.
-- Using permissive "allow all" policies for now.

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_art_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_item_decorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_art_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_firm_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item_decorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item_pick_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_item_po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omg_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.omg_store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.id_sequences ENABLE ROW LEVEL SECURITY;

-- Permissive policies: allow all operations for anon + authenticated
CREATE POLICY "allow_all" ON public.team_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.customer_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.product_inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.estimates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.estimate_art_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.estimate_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.estimate_item_decorations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_art_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_firm_dates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_item_decorations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_item_pick_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_item_po_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.so_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.invoice_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.invoice_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.message_reads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.omg_stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.omg_store_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.issues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.app_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON public.id_sequences FOR ALL USING (true) WITH CHECK (true);

-- Drop temp tables
DROP TABLE IF EXISTS _save_customers;
DROP TABLE IF EXISTS _save_contacts;
DROP TABLE IF EXISTS _save_profiles;
DROP TABLE IF EXISTS _save_deco_types;
DROP TABLE IF EXISTS _save_price_matrix;
DROP TABLE IF EXISTS _save_id_sequences;
DROP TABLE IF EXISTS _save_app_settings;
