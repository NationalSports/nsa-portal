-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 011: Club Webstores
-- Run this in the Supabase SQL Editor.
--
-- SAFETY: This migration is PURELY ADDITIVE.
--   • Only CREATE TABLE IF NOT EXISTS / CREATE VIEW / ADD COLUMN.
--   • No DROP, no RENAME, no type changes, no data backfill.
--   • Touches existing tables ONLY by adding new columns with defaults
--     (sales_orders.source, sales_orders.webstore_id) — existing rows and
--     the existing OMG flow (omg_stores / omg_store_id) are untouched.
--   • Keys the catalog on products.id (NOT sku) because SKUs are not unique
--     in this DB (e.g. A230 exists as both White and Green).
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- WEBSTORES — one row per club store
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webstores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,                 -- URL: /shop/<slug>
  name            TEXT NOT NULL,
  customer_id     TEXT REFERENCES customers(id),        -- the club (customers.id is TEXT)
  rep_id          TEXT REFERENCES team_members(id),     -- owning rep (team_members.id is TEXT)
  coach_contact_email TEXT,                             -- optional, for "nudge non-orderers"

  status          TEXT NOT NULL DEFAULT 'draft',        -- draft|open|closed|archived
  open_at         TIMESTAMPTZ,
  close_at        TIMESTAMPTZ,

  -- Checkout behavior
  payment_mode    TEXT NOT NULL DEFAULT 'paid',         -- paid|unpaid|either
  require_login   BOOLEAN DEFAULT false,                -- public or club-members-only

  -- Jersey number selection
  number_enabled  BOOLEAN DEFAULT false,
  number_unique   BOOLEAN DEFAULT true,                 -- block a number once taken (per store)
  number_min      INT DEFAULT 0,
  number_max      INT DEFAULT 99,

  -- Order batching into a sales_order
  so_creation     TEXT NOT NULL DEFAULT 'manual',       -- manual|on_close|daily|weekly
  so_next_run_at  TIMESTAMPTZ,

  -- Fundraising (optional per store)
  fundraise_enabled       BOOLEAN DEFAULT false,
  fundraise_pct           NUMERIC DEFAULT 0,            -- e.g. 0.15 → 15% markup
  fundraise_flat          NUMERIC DEFAULT 0,            -- or flat $ per item
  fundraise_show_parents  BOOLEAN DEFAULT false,        -- show "$X supports the team" at checkout

  -- Branding / theming (template-driven storefront reads these)
  logo_url        TEXT,
  banner_url      TEXT,
  primary_color   TEXT,
  accent_color    TEXT,
  hero_blurb      TEXT,
  theme           TEXT DEFAULT 'classic',               -- classic|bold|minimal preset

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webstores_customer ON webstores(customer_id);
CREATE INDEX IF NOT EXISTS idx_webstores_status ON webstores(status);

-- ─────────────────────────────────────────────────────────────────────
-- WEBSTORE_PRODUCTS — catalog (rep-curated). A row is either a single
-- product (kind='single', product_id set) or a bundle (kind='bundle',
-- product_id null, components in webstore_bundle_items).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webstore_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'single',         -- single|bundle
  product_id    TEXT REFERENCES products(id),           -- canonical product key (null for bundle)
  sku           TEXT,                                   -- denormalized for display
  display_name  TEXT,                                   -- override of products.name; bundle name when kind='bundle'
  retail_price  NUMERIC NOT NULL,                       -- single price OR the one package price for a bundle
  decoration_id UUID,                                   -- optional preset deco
  sort_order    INT DEFAULT 0,
  active        BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_webstore_products_store ON webstore_products(store_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webstore_products_single
  ON webstore_products(store_id, product_id, decoration_id)
  WHERE product_id IS NOT NULL;

-- Components of a bundle/package. Each points at a real product; can require
-- its own size and can carry the player's jersey number.
CREATE TABLE IF NOT EXISTS webstore_bundle_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id       UUID NOT NULL REFERENCES webstore_products(id) ON DELETE CASCADE,
  product_id      TEXT REFERENCES products(id),
  sku             TEXT,
  qty             INT NOT NULL DEFAULT 1,                -- e.g. 2 jerseys
  size_required   BOOLEAN DEFAULT true,                 -- false for one-size (socks, backpack)
  decoration_id   UUID,
  takes_number    BOOLEAN DEFAULT false,                -- carries the player's chosen number
  sort_order      INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_webstore_bundle_items_bundle ON webstore_bundle_items(bundle_id);

-- ─────────────────────────────────────────────────────────────────────
-- WEBSTORE_ORDERS — one row per customer checkout.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webstore_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES webstores(id),
  status          TEXT NOT NULL DEFAULT 'pending',      -- pending|paid|unpaid|batched|cancelled|refunded
  payment_mode    TEXT NOT NULL,                        -- paid|unpaid (resolved at checkout)
  order_kind      TEXT NOT NULL DEFAULT 'individual',   -- individual|bulk
  buyer_name      TEXT,
  buyer_email     TEXT,
  buyer_phone     TEXT,
  ship_address    JSONB,                                -- {name,street1,street2,city,state,zip,country}
  ship_method     TEXT DEFAULT 'ship',                  -- ship (pickup reserved for future)
  subtotal        NUMERIC NOT NULL DEFAULT 0,
  fundraise_amt   NUMERIC DEFAULT 0,
  tax             NUMERIC DEFAULT 0,
  shipping        NUMERIC DEFAULT 0,
  total           NUMERIC NOT NULL DEFAULT 0,
  stripe_pi_id    TEXT,                                 -- payment intent id; null when unpaid
  so_id           TEXT REFERENCES sales_orders(id),     -- set when batched (sales_orders.id is TEXT)
  status_token    TEXT UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webstore_orders_store_status ON webstore_orders(store_id, status);

CREATE TABLE IF NOT EXISTS webstore_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES webstore_orders(id) ON DELETE CASCADE,
  product_id      TEXT REFERENCES products(id),
  sku             TEXT,
  size            TEXT,
  qty             INT NOT NULL DEFAULT 1,
  unit_price      NUMERIC NOT NULL DEFAULT 0,           -- $0 for bundle components; package price on the parent line
  unit_fundraise  NUMERIC DEFAULT 0,
  decoration_id   UUID,
  player_name     TEXT,                                 -- captured per line; buyer is often a parent
  player_number   TEXT,
  -- Bundle grouping
  bundle_ref        UUID,                               -- groups the components of one purchased package
  bundle_product_id UUID REFERENCES webstore_products(id),
  is_bundle_parent  BOOLEAN DEFAULT false,
  -- Fulfillment status, synced down from the batched SO
  line_status     TEXT DEFAULT 'pending',               -- pending|in_production|shipped|complete|cancelled
  backordered     BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_webstore_order_items_order ON webstore_order_items(order_id);

-- ─────────────────────────────────────────────────────────────────────
-- WEBSTORE_ROSTER — optional per-store roster for "not yet ordered" tracking.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webstore_roster (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  player_name   TEXT NOT NULL,
  player_number TEXT,
  parent_email  TEXT,
  ordered       BOOLEAN DEFAULT false,
  UNIQUE (store_id, player_name, player_number)
);
CREATE INDEX IF NOT EXISTS idx_webstore_roster_store ON webstore_roster(store_id);

-- ─────────────────────────────────────────────────────────────────────
-- WEBSTORE_NUMBER_CLAIMS — jersey number uniqueness guard.
-- The UNIQUE (store_id, player_number) constraint is the real enforcement;
-- insert happens inside the checkout transaction for number_unique stores.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webstore_number_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  player_number TEXT NOT NULL,
  order_id      UUID REFERENCES webstore_orders(id) ON DELETE CASCADE,
  player_name   TEXT,
  claimed_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, player_number)
);
CREATE INDEX IF NOT EXISTS idx_webstore_number_claims_store ON webstore_number_claims(store_id);

-- ─────────────────────────────────────────────────────────────────────
-- Additive columns on sales_orders so batched webstore orders are traceable.
-- (sales_orders already has omg_store_id for the legacy OMG flow; we add a
-- parallel, separate webstore_id — the two never collide.)
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN source TEXT DEFAULT 'portal';   -- portal|webstore
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE sales_orders ADD COLUMN webstore_id UUID REFERENCES webstores(id);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- VIEW: webstore_product_eta — incoming stock from OPEN purchase orders.
-- POs live in so_item_po_lines (status 'received'/'cancelled' = closed).
-- product_id on PO lines is often NULL, so we expose BOTH a product_id key
-- and a sku key and let the storefront view coalesce.
-- NOTE: expected_date is frequently NULL today (reps don't always enter it),
-- so earliest_eta may be NULL even when qty is incoming — the UI shows
-- "On order" without a date in that case.
-- The sizes jsonb mixes real sizes with helper keys (unit_cost, drop_ship);
-- we sum only numeric-valued keys.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW webstore_product_eta AS
WITH open_lines AS (
  SELECT
    pol.id,
    si.product_id,
    si.sku,
    NULLIF(pol.expected_date, '') AS expected_date,
    (
      -- Sum only real size quantities: integer values on non-helper keys.
      -- The sizes jsonb also carries helper keys (unit_cost, drop_ship,
      -- _bill_cost, _bill_details, ...) which we exclude.
      SELECT COALESCE(SUM((kv.value)::int), 0)
      FROM jsonb_each_text(pol.sizes) AS kv(key, value)
      WHERE kv.key NOT LIKE '\_%' ESCAPE '\'
        AND kv.key NOT IN ('unit_cost', 'drop_ship')
        AND kv.value ~ '^[0-9]+$'
    ) AS on_order_qty
  FROM so_item_po_lines pol
  JOIN so_items si ON si.id = pol.so_item_id
  WHERE COALESCE(pol.status, '') NOT IN ('received', 'cancelled')
)
SELECT
  product_id,
  sku,
  SUM(on_order_qty)            AS on_order_qty,
  MIN(expected_date)          AS earliest_eta   -- ISO date text; NULL when none entered
FROM open_lines
GROUP BY product_id, sku;

-- ─────────────────────────────────────────────────────────────────────
-- VIEW: webstore_storefront_products — the ONLY product data the public
-- storefront reads. No cost / vendor columns. Stock comes from
-- product_inventory aggregated per size. ETA joins on product_id, falling
-- back to sku when the catalog row has no product_id match.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW webstore_storefront_products AS
SELECT
  wp.id            AS webstore_product_id,
  wp.store_id,
  wp.kind,
  wp.product_id,
  wp.sku,
  COALESCE(wp.display_name, p.name) AS name,
  p.category,
  p.color,
  p.available_sizes,
  p.image_front_url,
  p.image_back_url,
  wp.retail_price,
  wp.decoration_id,
  wp.sort_order,
  inv.size_stock,
  COALESCE(eta_pid.on_order_qty, eta_sku.on_order_qty) AS on_order_qty,
  COALESCE(eta_pid.earliest_eta, eta_sku.earliest_eta) AS earliest_eta
FROM webstore_products wp
LEFT JOIN products p ON p.id = wp.product_id
LEFT JOIN (
  SELECT product_id, jsonb_object_agg(size, quantity) AS size_stock
  FROM product_inventory
  GROUP BY product_id
) inv ON inv.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_pid ON eta_pid.product_id = wp.product_id
LEFT JOIN webstore_product_eta eta_sku ON eta_sku.product_id IS NULL AND eta_sku.sku = wp.sku
WHERE wp.active = true;

-- ─────────────────────────────────────────────────────────────────────
-- RLS — enabled on all new tables. Policies are permissive ("Allow all")
-- to match the rest of this database, so the existing portal (which uses
-- the anon/publishable key with app-level gating) keeps working unchanged.
--
-- ⚠️  HARDENING REQUIRED BEFORE PUBLIC LAUNCH: the public storefront will be
-- exposed to the open internet. Before flipping any store to status='open',
-- replace these with scoped policies (public SELECT only on open stores +
-- the storefront view; order INSERT via an edge function or token-scoped
-- policy; staff full access via service role). Nothing is public yet — no
-- storefront is built — so permissive is safe for development only.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE webstores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_bundle_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_roster      ENABLE ROW LEVEL SECURITY;
ALTER TABLE webstore_number_claims ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "Allow all" ON webstores            FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_products    FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_bundle_items FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_orders      FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_order_items FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_roster      FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Allow all" ON webstore_number_claims FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
