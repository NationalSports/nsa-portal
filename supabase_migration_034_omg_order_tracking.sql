-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 034: OMG order tracking via the webstore rails
-- Run this in the Supabase SQL Editor.
--
-- GOAL: let OMG pop-up sales reuse the existing webstore order-tracking
-- infrastructure (public status_token page, line_status sync trigger,
-- ShipStation webhook, Brevo emails) WITHOUT building parallel tables and
-- WITHOUT disturbing the live webstore or the OMG aggregate flow.
--
-- APPROACH — "shadow webstore":
--   • Each OMG sale gets one row in `webstores` (source='omg', status
--     'archived' so it is never treated as a live shopping store — only its
--     /order/<token> page is used).
--   • Each OMG order becomes a `webstore_orders` row; its line items become
--     `webstore_order_items` rows. They inherit status_token, the public
--     order page, the status-sync trigger, and the ShipStation webhook
--     (which matches orderNumber 'WS-' + webstore_orders.id) for free.
--
-- SAFETY: PURELY ADDITIVE.
--   • Only ADD COLUMN (guarded) + CREATE INDEX IF NOT EXISTS.
--   • No DROP / RENAME / type change / data backfill.
--   • Existing webstores default to source='webstore' — behavior unchanged.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- webstores: tag the row's origin and link back to the OMG sale.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE webstores ADD COLUMN source TEXT NOT NULL DEFAULT 'webstore'; -- webstore|omg
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE webstores ADD COLUMN omg_sale_code TEXT;   -- e.g. 'D2SVU' (null for native webstores)
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- One shadow webstore per OMG sale code.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webstores_omg_sale_code
  ON webstores(omg_sale_code) WHERE omg_sale_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- webstore_orders: carry the OMG order number so we can (a) match the
-- packing slip for contact enrichment and (b) re-ingest idempotently.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE webstore_orders ADD COLUMN omg_order_number TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- An OMG order number is unique within its shadow store.
CREATE UNIQUE INDEX IF NOT EXISTS uq_webstore_orders_omg_number
  ON webstore_orders(store_id, omg_order_number) WHERE omg_order_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- webstore_order_items: warehouse "missing / short-shipped" flag, shown on
-- the parent's order page. (`backordered` already exists for incoming-stock;
-- this is specifically a fulfillment shortage marked by the warehouse.)
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE webstore_order_items ADD COLUMN missing_qty INT NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Denormalized display fields the OMG report carries but the native webstore
-- path derives from products. Keeping them on the line lets the OMG order page
-- render product name / color without a products.id match.
DO $$ BEGIN
  ALTER TABLE webstore_order_items ADD COLUMN name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE webstore_order_items ADD COLUMN color TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE webstore_order_items ADD COLUMN image_url TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- Track the "order processing started" email so we never double-send.
-- (Native webstores have webstore_orders.confirmation_sent from migration 027;
--  this is a separate, processing-stage notification.)
DO $$ BEGIN
  ALTER TABLE webstore_orders ADD COLUMN processing_email_sent BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE webstore_orders ADD COLUMN processing_email_sent_at TIMESTAMPTZ;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
