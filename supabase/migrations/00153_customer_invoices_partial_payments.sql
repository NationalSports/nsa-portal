-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 00153: customer_invoices partial-payment tracking
-- ═══════════════════════════════════════════════════════════════════
-- customer_invoices (migration 007) mirrors NetSuite invoice TOTALS only and
-- had no way to record a payment against an imported invoice — recordPayment
-- could only flip `status`, so a partial payment (e.g. $50k of a $59,859.40
-- invoice) left the portal showing the full balance with nothing "applied".
--
-- These two columns let the portal track a real paid amount + a payment
-- breakdown on imported invoices, so the invoice detail shows Paid / Balance
-- Due and a Payment History row. NetSuite remains the system of record for AR;
-- the NetSuite loader (scripts/load-netsuite-invoices.py) does NOT write these
-- columns, so a re-import preserves the portal-side payment tracking.

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS paid NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS payments JSONB NOT NULL DEFAULT '[]'::jsonb;
