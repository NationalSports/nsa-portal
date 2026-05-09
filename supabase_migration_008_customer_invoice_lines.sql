-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 008: Customer Invoice / Sales Order Lines
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
-- Stores one row per line item across NetSuite Sales Orders, Invoices,
-- and Credit Memos imported from a Main-Line=false saved-search export.
-- Pairs with customer_invoices (header-level totals from migration 007).
-- Powers the Sales History rep search tool — reps can search across
-- 3 years of transactions by customer, document number, or SKU and
-- see every line item.
--
-- Idempotent re-import: (netsuite_internal_id, line_seq) is unique, and
-- the loader DELETEs all lines for the transaction ids in the batch
-- before inserting, so re-running with a fresh export replaces in place.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS customer_invoice_lines (
  id                    TEXT PRIMARY KEY,

  -- NetSuite transaction internal ID (the parent SO/invoice/credit memo).
  netsuite_internal_id  TEXT NOT NULL,
  -- Order of this line within the parent transaction, computed at load
  -- time from the export's row order. Stable across re-imports as long
  -- as the saved search returns lines in the same order (it does).
  line_seq              INTEGER NOT NULL,

  -- Link to our customers table; nullable so lines from customers we
  -- haven't imported yet still land. A post-load JOIN on
  -- raw_customer_nsid populates this; re-running picks up new customers.
  customer_id           TEXT REFERENCES customers(id) ON DELETE SET NULL,
  raw_customer_nsid     TEXT,
  raw_customer_name     TEXT,

  -- 'sales_order' | 'invoice' | 'credit_memo'
  transaction_type      TEXT NOT NULL,
  document_number       TEXT,
  transaction_date      DATE NOT NULL,
  status                TEXT,

  -- Line detail.
  item                  TEXT,
  description           TEXT,
  quantity              NUMERIC,
  rate                  NUMERIC,
  amount                NUMERIC,

  -- Header memo (same on every line of the same transaction) and the
  -- per-line memo (often the item description in NetSuite).
  header_memo           TEXT,
  line_memo             TEXT,

  source_file           TEXT,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cil_txn_seq
  ON customer_invoice_lines(netsuite_internal_id, line_seq);

CREATE INDEX IF NOT EXISTS idx_cil_customer
  ON customer_invoice_lines(customer_id);

CREATE INDEX IF NOT EXISTS idx_cil_date
  ON customer_invoice_lines(transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_cil_document
  ON customer_invoice_lines(document_number);

CREATE INDEX IF NOT EXISTS idx_cil_item
  ON customer_invoice_lines(item);

CREATE INDEX IF NOT EXISTS idx_cil_raw_nsid
  ON customer_invoice_lines(raw_customer_nsid)
  WHERE raw_customer_nsid IS NOT NULL;

-- Trigram indexes power the rep-facing fuzzy search (customer name +
-- SKU). ILIKE '%foo%' uses these instead of full-table scans.
CREATE INDEX IF NOT EXISTS idx_cil_customer_name_trgm
  ON customer_invoice_lines USING gin (lower(raw_customer_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cil_item_trgm
  ON customer_invoice_lines USING gin (lower(item) gin_trgm_ops);

DO $$ BEGIN
  CREATE TRIGGER trg_customer_invoice_lines_updated
  BEFORE UPDATE ON customer_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE customer_invoice_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_invoice_lines FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
