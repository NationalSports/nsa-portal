-- Add unique constraint on customer_contacts(customer_id, sort_order) for upsert support
ALTER TABLE public.customer_contacts
  ADD CONSTRAINT customer_contacts_cust_sort_uniq UNIQUE (customer_id, sort_order);

-- Add missing email tracking columns to invoices table
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS email_status TEXT,
  ADD COLUMN IF NOT EXISTS email_sent_at TEXT,
  ADD COLUMN IF NOT EXISTS email_opened_at TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_at TEXT,
  ADD COLUMN IF NOT EXISTS sent_history JSONB;

-- Add missing columns that code references
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS inv_type TEXT,
  ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS tax NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS shipping NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_items JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
