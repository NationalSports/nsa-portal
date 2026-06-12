-- Flat coach catalog sell price for items that don't follow the adidas tier
-- discount (e.g. S&S Activewear adidas = cost x 1.65). When set, the coach
-- catalog shows this as the signed-in price instead of retail x (1 - tier disc).
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS catalog_sell_price NUMERIC;

-- Backfill existing S&S adidas items at cost x 1.65 (standard markup, no tier).
UPDATE public.products
SET catalog_sell_price = round(nsa_cost * 1.65, 2)
WHERE id LIKE 'ssa-%' AND nsa_cost > 0;
