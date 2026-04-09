-- Add missing tax_exempt and notes columns to the customers table.
-- The app sends these fields on every customer save, but they were never
-- added to the production database, causing upserts to fail.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tax_exempt BOOLEAN DEFAULT false;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS notes TEXT;
