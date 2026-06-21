-- Adds products.pricing_group to flag items that use a non-standard tier discount schedule.
-- 'lockerroom' items use A=35% / B=30% / C=25% off retail (vs the standard A=40% / B=35% / C=30%).
-- Backfills the existing Lockerroom bulk-import batch (id prefix 'p-lr-1775595054443-').

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pricing_group text;

UPDATE public.products
SET pricing_group = 'lockerroom'
WHERE id LIKE 'p-lr-1775595054443-%';
