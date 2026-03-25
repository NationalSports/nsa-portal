-- Add credit_applied and credit_amount columns to estimates and sales_orders.
-- These columns are referenced in _estCols and _soCols but were never added to
-- the DB schema. The missing columns caused the first upsert to fail, triggering
-- the fallback retry that strips _estExtraCols (which includes approved_by).
-- This meant coach approvals were saved with status='approved' but no approved_by,
-- so the green banner and todo list filter (approved_by==='Coach') both failed.

-- estimates
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS credit_applied BOOLEAN DEFAULT false;
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(10,2) DEFAULT 0;

-- sales_orders
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS credit_applied BOOLEAN DEFAULT false;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS credit_amount NUMERIC(10,2) DEFAULT 0;
