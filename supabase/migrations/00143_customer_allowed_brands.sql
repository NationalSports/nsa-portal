-- Per-account catalog brand restriction. Limits which catalog brands a
-- customer's coaches can see on /adidas. Stored like school_colors: a JSONB
-- array of brand names matching CATALOG_BRANDS in
-- src/storefront/AdidasInventory.js, e.g. ["Adidas"]. NULL or [] = no
-- restriction (all brands), so every existing account is unchanged.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS allowed_brands JSONB;
