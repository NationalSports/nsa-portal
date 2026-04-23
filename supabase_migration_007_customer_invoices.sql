-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 007: Customer Invoices (sales history)
-- Run this in Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════════
-- Stores one row per NetSuite invoice (or credit memo) imported from the
-- "NSA Portal – Invoice Totals" saved search. Totals only — we deliberately
-- do not import line items. Designed for sales-history reporting joined to
-- customers via netsuite_internal_id.
--
-- Idempotent re-import: netsuite_internal_id has a UNIQUE index so running
-- the loader twice updates in place instead of duplicating.

CREATE TABLE IF NOT EXISTS customer_invoices (
  id                    TEXT PRIMARY KEY,
  -- Link to our customers table. Nullable so invoices from NetSuite whose
  -- customer hasn't been imported yet still land here with their raw_customer_nsid
  -- preserved — a reconciliation pass can fill customer_id later.
  customer_id           TEXT REFERENCES customers(id) ON DELETE SET NULL,

  -- Preserves the link to the NetSuite customer even when customer_id is NULL,
  -- so a later re-match pass can attach it.
  raw_customer_nsid     TEXT,
  raw_customer_name     TEXT,

  -- NetSuite transaction internal ID — the stable key for idempotency.
  netsuite_internal_id  TEXT NOT NULL,
  -- Visible document number (e.g. INV12345). Not unique in NetSuite because
  -- credit memos use a different series but could collide rarely.
  document_number       TEXT,

  invoice_date          DATE NOT NULL,
  -- 'invoice' | 'credit_memo' — credit memos roll into sales totals as negatives.
  type                  TEXT NOT NULL DEFAULT 'invoice',
  -- 'paid' | 'open' | 'void' | 'pending_approval' | etc. — kept free-text so
  -- NetSuite status variations don't break the loader.
  status                TEXT,

  subsidiary            TEXT,
  rep_name              TEXT,              -- snapshot at invoice time, not FK

  subtotal              NUMERIC,
  tax                   NUMERIC,
  total                 NUMERIC NOT NULL,

  memo                  TEXT,

  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_invoices_nsid
  ON customer_invoices(netsuite_internal_id);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer
  ON customer_invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_date
  ON customer_invoices(invoice_date);

CREATE INDEX IF NOT EXISTS idx_customer_invoices_raw_nsid
  ON customer_invoices(raw_customer_nsid)
  WHERE raw_customer_nsid IS NOT NULL;

-- Keep updated_at current on row updates (matches the pattern used elsewhere).
DO $$ BEGIN
  CREATE TRIGGER trg_customer_invoices_updated
  BEFORE UPDATE ON customer_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS matches the rest of the schema.
ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all" ON customer_invoices FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
