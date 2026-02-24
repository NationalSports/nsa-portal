-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Normalized Database Migration
-- Run this in Supabase SQL Editor BEFORE deploying the updated App.js
-- ═══════════════════════════════════════════════════════════════════

-- Step 0: Backup existing flat tables
ALTER TABLE IF EXISTS team_members RENAME TO _backup_team_members;
ALTER TABLE IF EXISTS customers RENAME TO _backup_customers;
ALTER TABLE IF EXISTS vendors RENAME TO _backup_vendors;
ALTER TABLE IF EXISTS products RENAME TO _backup_products;
ALTER TABLE IF EXISTS estimates RENAME TO _backup_estimates;
ALTER TABLE IF EXISTS sales_orders RENAME TO _backup_sales_orders;
ALTER TABLE IF EXISTS invoices RENAME TO _backup_invoices;
ALTER TABLE IF EXISTS messages RENAME TO _backup_messages;
ALTER TABLE IF EXISTS omg_stores RENAME TO _backup_omg_stores;
ALTER TABLE IF EXISTS issues RENAME TO _backup_issues;

-- ═══ CORE TABLES ═══

CREATE TABLE team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
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
  primary_rep_id TEXT REFERENCES team_members(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_customers_parent ON customers(parent_id);
CREATE INDEX idx_customers_rep ON customers(primary_rep_id);

CREATE TABLE customer_contacts (
  id SERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  sort_order INT DEFAULT 0
);
CREATE INDEX idx_customer_contacts_cust ON customer_contacts(customer_id);

CREATE TABLE vendors (
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

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  vendor_id TEXT REFERENCES vendors(id),
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
CREATE INDEX idx_products_vendor ON products(vendor_id);
CREATE INDEX idx_products_sku ON products(sku);

CREATE TABLE product_inventory (
  id SERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size TEXT NOT NULL,
  quantity INT DEFAULT 0,
  alert_threshold INT,
  UNIQUE(product_id, size)
);
CREATE INDEX idx_product_inv_product ON product_inventory(product_id);

-- ═══ ESTIMATES ═══

CREATE TABLE estimates (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  memo TEXT,
  status TEXT DEFAULT 'draft',
  created_by TEXT REFERENCES team_members(id),
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
CREATE INDEX idx_estimates_customer ON estimates(customer_id);
CREATE INDEX idx_estimates_status ON estimates(status);
CREATE INDEX idx_estimates_deleted ON estimates(deleted_at);

CREATE TABLE estimate_art_files (
  id TEXT NOT NULL,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
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

CREATE TABLE estimate_items (
  id SERIAL PRIMARY KEY,
  estimate_id TEXT NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  item_index INT NOT NULL,
  product_id TEXT REFERENCES products(id),
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
CREATE INDEX idx_estimate_items_est ON estimate_items(estimate_id);

CREATE TABLE estimate_item_decorations (
  id SERIAL PRIMARY KEY,
  estimate_item_id INT NOT NULL REFERENCES estimate_items(id) ON DELETE CASCADE,
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
  _showRoster BOOLEAN DEFAULT false
);
CREATE INDEX idx_est_item_decos_item ON estimate_item_decorations(estimate_item_id);

-- ═══ SALES ORDERS ═══

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  estimate_id TEXT REFERENCES estimates(id) ON DELETE SET NULL,
  memo TEXT,
  status TEXT DEFAULT 'need_order',
  created_by TEXT REFERENCES team_members(id),
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
CREATE INDEX idx_so_customer ON sales_orders(customer_id);
CREATE INDEX idx_so_status ON sales_orders(status);
CREATE INDEX idx_so_estimate ON sales_orders(estimate_id);
CREATE INDEX idx_so_deleted ON sales_orders(deleted_at);

CREATE TABLE so_art_files (
  id TEXT NOT NULL,
  so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
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

CREATE TABLE so_firm_dates (
  id SERIAL PRIMARY KEY,
  so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_desc TEXT,
  date TEXT,
  approved BOOLEAN DEFAULT false
);
CREATE INDEX idx_so_firm_dates_so ON so_firm_dates(so_id);

CREATE TABLE so_items (
  id SERIAL PRIMARY KEY,
  so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_index INT NOT NULL,
  product_id TEXT REFERENCES products(id),
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
CREATE INDEX idx_so_items_so ON so_items(so_id);

CREATE TABLE so_item_decorations (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES so_items(id) ON DELETE CASCADE,
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
  _showRoster BOOLEAN DEFAULT false
);
CREATE INDEX idx_so_item_decos_item ON so_item_decorations(so_item_id);

CREATE TABLE so_item_pick_lines (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES so_items(id) ON DELETE CASCADE,
  pick_id TEXT,
  sizes JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pick',
  created_at TEXT,
  memo TEXT,
  ship_dest TEXT DEFAULT 'in_house',
  ship_addr TEXT,
  deco_vendor TEXT
);
CREATE INDEX idx_so_picks_item ON so_item_pick_lines(so_item_id);

CREATE TABLE so_item_po_lines (
  id SERIAL PRIMARY KEY,
  so_item_id INT NOT NULL REFERENCES so_items(id) ON DELETE CASCADE,
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
CREATE INDEX idx_so_pos_item ON so_item_po_lines(so_item_id);

CREATE TABLE so_jobs (
  id TEXT NOT NULL,
  so_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
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
CREATE INDEX idx_so_jobs_so ON so_jobs(so_id);

-- ═══ INVOICES ═══

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  so_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'invoice',
  date TEXT,
  due_date TEXT,
  total NUMERIC DEFAULT 0,
  paid NUMERIC DEFAULT 0,
  memo TEXT,
  status TEXT DEFAULT 'open',
  cc_fee NUMERIC DEFAULT 0,
  created_by TEXT REFERENCES team_members(id),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_so ON invoices(so_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_deleted ON invoices(deleted_at);

CREATE TABLE invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount NUMERIC,
  method TEXT,
  ref TEXT,
  date TEXT
);
CREATE INDEX idx_inv_payments_inv ON invoice_payments(invoice_id);

CREATE TABLE invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  qty INT,
  unit_price NUMERIC,
  total NUMERIC,
  description TEXT
);
CREATE INDEX idx_inv_items_inv ON invoice_items(invoice_id);

-- ═══ MESSAGES ═══

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  so_id TEXT REFERENCES sales_orders(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers(id),
  author_id TEXT REFERENCES team_members(id),
  author TEXT,
  dept TEXT,
  text TEXT,
  ts TEXT,
  priority TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_so ON messages(so_id);

CREATE TABLE message_reads (
  id SERIAL PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES team_members(id),
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);
CREATE INDEX idx_msg_reads_msg ON message_reads(message_id);
CREATE INDEX idx_msg_reads_user ON message_reads(user_id);

-- ═══ OMG STORES ═══

CREATE TABLE omg_stores (
  id TEXT PRIMARY KEY,
  store_name TEXT,
  customer_id TEXT REFERENCES customers(id),
  rep_id TEXT REFERENCES team_members(id),
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
CREATE INDEX idx_omg_customer ON omg_stores(customer_id);

CREATE TABLE omg_store_products (
  id SERIAL PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES omg_stores(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  color TEXT,
  retail NUMERIC,
  cost NUMERIC,
  deco_type TEXT,
  deco_cost NUMERIC,
  sizes JSONB DEFAULT '{}'
);
CREATE INDEX idx_omg_products_store ON omg_store_products(store_id);

-- ═══ ISSUES ═══

CREATE TABLE issues (
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

-- ═══ ENABLE REALTIME ═══

ALTER PUBLICATION supabase_realtime ADD TABLE estimates;
ALTER PUBLICATION supabase_realtime ADD TABLE sales_orders;
ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE issues;
ALTER PUBLICATION supabase_realtime ADD TABLE so_items;
ALTER PUBLICATION supabase_realtime ADD TABLE so_item_pick_lines;
ALTER PUBLICATION supabase_realtime ADD TABLE so_item_po_lines;

-- ═══ ROW LEVEL SECURITY (basic — all authenticated users can CRUD) ═══

ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE omg_stores ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated + anon (since the app uses anon key)
CREATE POLICY "Allow all" ON team_members FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON customer_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON vendors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON product_inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON estimates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON estimate_art_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON estimate_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON estimate_item_decorations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_art_files FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_firm_dates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_item_decorations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_item_pick_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_item_po_lines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON so_jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON invoice_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON invoice_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON message_reads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON omg_stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON omg_store_products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON issues FOR ALL USING (true) WITH CHECK (true);
