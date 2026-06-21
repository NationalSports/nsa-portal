-- Product descriptions for the public catalog pages. Backfilled once per SKU
-- from the Cowork product page by the inventory-sync task (fill-empty-only,
-- same rule as image backfill); shown in the /adidas style detail view.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description TEXT;
