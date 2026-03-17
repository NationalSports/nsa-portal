-- Store tax_rate and tax_exempt on sales_orders so historical orders keep the rate in effect at creation
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS tax_rate NUMERIC DEFAULT 0;
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN DEFAULT false;
