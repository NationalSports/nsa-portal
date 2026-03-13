-- Add _inbound_freight column to sales_orders for storing inbound freight costs
-- parsed from supplier bill PDFs. Without this column, freight data set by
-- applyBillToSO() cannot persist to the database (falls back to core-only save).
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS _inbound_freight NUMERIC;

-- Add _shipstation_cost column (also in _soExtraCols, never migrated)
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS _shipstation_cost NUMERIC;
