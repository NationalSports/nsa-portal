-- Track warehouse "Deliver" tab completions per sales order.
-- Keyed map of delivered tasks: { "job|JOB-123": {at, by}, "nd|0": {at, by} }
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS delivered jsonb DEFAULT '{}'::jsonb;
