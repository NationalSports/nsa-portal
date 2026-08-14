-- Encinitas Express Soccer — club-owned decorated stock on hand at NSA
-- Source: club inventory count sheet (2026-08-14). Customer: c-ns-3978 "Encinitas Express Soccer".
--
-- Why new catalog rows: the base adidas articles (JD7373, KB4028, JY5390, …) exist only as
-- generic "…Custom" order rows (color=CUSTOM, no sizes, inventory_source='click') shared by every
-- club that orders that style. On-hand stock lives in product_inventory keyed by product_id with
-- no owner column, so putting Express's decorated goods on those shared rows would report them as
-- NSA stock available to every other club. The count sheet already carries its own '-EXP' SKUs;
-- this mirrors that — one catalog row per sheet line, named "Encinitas Express — …".
--
-- SKU disambiguation: the sheet reuses JD7371-EXP and JD7370-EXP for both the White and Navy
-- colorway. SKUs are unique in `products`, so those four rows follow the sheet's own youth-jersey
-- convention and take a -N / -W colour suffix.
--
-- Sizes are recorded exactly as the sheet labels them (its "2X" column normalized to 2XL, the
-- backpack's single count to OSFA).
--
-- Pricing: every garment here is a Locker Room custom adidas item, so each carries
-- pricing_group='lockerroom' — the flag auTierDisc reads to price the reduced Locker Room tier
-- schedule (A=35% / B=30% / C=25% off retail) instead of the standard A=40% / B=35% / C=30%. All
-- 13 base articles already in the catalog carry it; dropping it here would quietly discount this
-- club's goods 5 points too deep at every tier.
--
-- Cost is retail x .55 x .75, with the penny truncated, not rounded: 55 retail -> 22.6875 -> 22.68.
-- Retail for the six red goalkeeper/short articles (JF2887, JF2881, JF2871, JJ4162, JF2872,
-- JP0179) came from the club — they aren't in the catalog at all. Note the base articles carry the
-- rounded-UP penny on the 35/50/55 retails (14.44 / 20.63 / 22.69); section 3 truncates those to
-- match. 119 other Locker Room rows carry the same rounded-up penny and are NOT touched here.
--
-- The backpack is the one exception on both counts: it is a stock Agron article, not Locker Room
-- custom, so it takes no pricing_group and keeps its catalog cost of 24.38 on a 65 retail
-- (the stock Adidas/Agron rate of retail x .5 x .75, not x .55 x .75).
--
-- Idempotent: re-running re-applies the same quantities. Run in the Supabase SQL editor.

BEGIN;

-- 1. Catalog rows -----------------------------------------------------------
INSERT INTO products (
  id, sku, name, brand, color, category, vendor_id, pricing_group,
  nsa_cost, retail_price, available_sizes, inventory_source, is_active, is_archived, updated_at
) VALUES
  ('p-exp-JD7373-EXP-W','JD7373-EXP-W','Encinitas Express — Youth Jersey','Adidas','White','Jersey','v1','lockerroom',20.62,50,'["XS","S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JD7373-EXP-N','JD7373-EXP-N','Encinitas Express — Youth Jersey','Adidas','Navy','Jersey','v1','lockerroom',20.62,50,'["XS","S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB4028-EXP','KB4028-EXP','Encinitas Express — Youth Shorts','Adidas','Navy','Shorts','v1','lockerroom',14.43,35,'["XS","S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JY5390-EXP','JY5390-EXP','Encinitas Express — Youth Jacket','Adidas','Navy','Outerwear','v1','lockerroom',24.75,60,'["M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JY5395-EXP','JY5395-EXP','Encinitas Express — Youth Pant','Adidas','Navy','Pants','v1','lockerroom',22.68,55,'["XS","S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JD7371-EXP-W','JD7371-EXP-W','Encinitas Express — Adult Jersey','Adidas','White','Jersey','v1','lockerroom',22.68,55,'["S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JD7371-EXP-N','JD7371-EXP-N','Encinitas Express — Adult Jersey','Adidas','Navy','Jersey','v1','lockerroom',22.68,55,'["S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB4029-EXP','KB4029-EXP','Encinitas Express — Adult Shorts','Adidas','Navy','Shorts','v1','lockerroom',16.50,40,'["M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB4042-EXP','KB4042-EXP','Encinitas Express — Adult Jacket','Adidas','Navy','Outerwear','v1','lockerroom',26.81,65,'["S","M","L","XL","2XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KE9910-EXP','KE9910-EXP','Encinitas Express — Adult Pant','Adidas','Navy','Pants','v1','lockerroom',24.75,60,'["S","M","L","XL","2XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JD7370-EXP-N','JD7370-EXP-N','Encinitas Express — Womens Jersey','Adidas','Navy','Jersey','v1','lockerroom',22.68,55,'["S","M","L"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JD7370-EXP-W','JD7370-EXP-W','Encinitas Express — Womens Jersey','Adidas','White','Jersey','v1','lockerroom',22.68,55,'["S","M","L"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB4032-EXP','KB4032-EXP','Encinitas Express — Womens Shorts','Adidas','Navy','Shorts','v1','lockerroom',16.50,40,'["XS","S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB4037-EXP','KB4037-EXP','Encinitas Express — Womens Jacket','Adidas','Navy','Outerwear','v1','lockerroom',26.81,65,'["M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JY5389-EXP','JY5389-EXP','Encinitas Express — Womens Pant','Adidas','Navy','Pants','v1','lockerroom',24.75,60,'["S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JF2887-EXP','JF2887-EXP','Encinitas Express — Youth GK Jersey LS','Adidas','Red','Jersey',NULL,'lockerroom',28.87,70,'["XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JF2881-EXP','JF2881-EXP','Encinitas Express — Adult GK Jersey LS','Adidas','Red','Jersey',NULL,'lockerroom',30.93,75,'["S","M","L"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JF2871-EXP','JF2871-EXP','Encinitas Express — Womens GK Jersey LS','Adidas','Red','Jersey',NULL,'lockerroom',30.93,75,'["S","M","L"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JJ4162-EXP','JJ4162-EXP','Encinitas Express — Womens GK Shorts','Adidas','Red','Shorts',NULL,'lockerroom',20.62,50,'["S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JF2872-EXP','JF2872-EXP','Encinitas Express — Youth GK Shorts','Adidas','Red','Shorts',NULL,'lockerroom',20.62,50,'["S","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-JP0179-EXP','JP0179-EXP','Encinitas Express — Adult GK Shorts','Adidas','Red','Shorts',NULL,'lockerroom',20.62,50,'["S","M","L","XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-KB3914-EXP','KB3914-EXP','Encinitas Express — Adult All Weather Jacket','Adidas','Navy','Outerwear','v1','lockerroom',35.06,85,'["L","XL","2XL"]'::jsonb,'manual',true,false,now()),
  ('p-exp-5159406-EXP','5159406-EXP','Encinitas Express — Stadium 4 Backpack','Adidas','Navy','Bags','v1777312659133',NULL,24.38,65,'["OSFA"]'::jsonb,'manual',true,false,now())
ON CONFLICT (id) DO UPDATE SET
  sku              = EXCLUDED.sku,
  name             = EXCLUDED.name,
  brand            = EXCLUDED.brand,
  color            = EXCLUDED.color,
  category         = EXCLUDED.category,
  vendor_id        = EXCLUDED.vendor_id,
  pricing_group    = EXCLUDED.pricing_group,
  nsa_cost         = EXCLUDED.nsa_cost,
  retail_price     = EXCLUDED.retail_price,
  available_sizes  = EXCLUDED.available_sizes,
  inventory_source = EXCLUDED.inventory_source,
  is_active        = EXCLUDED.is_active,
  is_archived      = EXCLUDED.is_archived,
  updated_at       = now();

-- 2. On-hand quantities -----------------------------------------------------
-- JD7373-EXP-W (White Youth Jersey) is on the sheet with every size blank, so it gets a catalog
-- row and no counts — nothing was counted, which is not the same as a counted zero.
INSERT INTO product_inventory (product_id, size, quantity) VALUES
  -- Youth Jersey, Navy — 330
  ('p-exp-JD7373-EXP-N','XS',12), ('p-exp-JD7373-EXP-N','S',55), ('p-exp-JD7373-EXP-N','M',112), ('p-exp-JD7373-EXP-N','L',108), ('p-exp-JD7373-EXP-N','XL',43),
  -- Youth Shorts, Navy — 130
  ('p-exp-KB4028-EXP','XS',4), ('p-exp-KB4028-EXP','S',44), ('p-exp-KB4028-EXP','M',50), ('p-exp-KB4028-EXP','L',3), ('p-exp-KB4028-EXP','XL',29),
  -- Youth Jacket, Navy — 95
  ('p-exp-JY5390-EXP','M',12), ('p-exp-JY5390-EXP','L',55), ('p-exp-JY5390-EXP','XL',28),
  -- Youth Pant, Navy — 115
  ('p-exp-JY5395-EXP','XS',13), ('p-exp-JY5395-EXP','S',21), ('p-exp-JY5395-EXP','M',36), ('p-exp-JY5395-EXP','L',30), ('p-exp-JY5395-EXP','XL',15),
  -- Adult Jersey, White — 208
  ('p-exp-JD7371-EXP-W','S',93), ('p-exp-JD7371-EXP-W','M',64), ('p-exp-JD7371-EXP-W','L',47), ('p-exp-JD7371-EXP-W','XL',4),
  -- Adult Jersey, Navy — 198
  ('p-exp-JD7371-EXP-N','S',86), ('p-exp-JD7371-EXP-N','M',61), ('p-exp-JD7371-EXP-N','L',47), ('p-exp-JD7371-EXP-N','XL',4),
  -- Adult Shorts, Navy — 13
  ('p-exp-KB4029-EXP','M',5), ('p-exp-KB4029-EXP','L',3), ('p-exp-KB4029-EXP','XL',5),
  -- Adult Jacket, Navy — 106
  ('p-exp-KB4042-EXP','S',53), ('p-exp-KB4042-EXP','M',32), ('p-exp-KB4042-EXP','L',14), ('p-exp-KB4042-EXP','XL',2), ('p-exp-KB4042-EXP','2XL',5),
  -- Adult Pant, Navy — 44
  ('p-exp-KE9910-EXP','S',21), ('p-exp-KE9910-EXP','M',13), ('p-exp-KE9910-EXP','L',2), ('p-exp-KE9910-EXP','XL',3), ('p-exp-KE9910-EXP','2XL',5),
  -- Womens Jersey, Navy — 74
  ('p-exp-JD7370-EXP-N','S',33), ('p-exp-JD7370-EXP-N','M',28), ('p-exp-JD7370-EXP-N','L',13),
  -- Womens Jersey, White — 74
  ('p-exp-JD7370-EXP-W','S',33), ('p-exp-JD7370-EXP-W','M',28), ('p-exp-JD7370-EXP-W','L',13),
  -- Womens Shorts, Navy — 82
  ('p-exp-KB4032-EXP','XS',3), ('p-exp-KB4032-EXP','S',3), ('p-exp-KB4032-EXP','M',61), ('p-exp-KB4032-EXP','L',12), ('p-exp-KB4032-EXP','XL',3),
  -- Womens Jacket, Navy — 14
  ('p-exp-KB4037-EXP','M',11), ('p-exp-KB4037-EXP','L',1), ('p-exp-KB4037-EXP','XL',2),
  -- Womens Pant, Navy — 13
  ('p-exp-JY5389-EXP','S',3), ('p-exp-JY5389-EXP','M',5), ('p-exp-JY5389-EXP','L',2), ('p-exp-JY5389-EXP','XL',3),
  -- Red goalkeeper kit — 91
  ('p-exp-JF2887-EXP','XL',2),
  ('p-exp-JF2881-EXP','S',7), ('p-exp-JF2881-EXP','M',3), ('p-exp-JF2881-EXP','L',5),
  ('p-exp-JF2871-EXP','S',7), ('p-exp-JF2871-EXP','M',7), ('p-exp-JF2871-EXP','L',3),
  ('p-exp-JJ4162-EXP','S',4), ('p-exp-JJ4162-EXP','M',4), ('p-exp-JJ4162-EXP','L',5), ('p-exp-JJ4162-EXP','XL',2),
  ('p-exp-JF2872-EXP','S',3), ('p-exp-JF2872-EXP','L',16), ('p-exp-JF2872-EXP','XL',1),
  ('p-exp-JP0179-EXP','S',4), ('p-exp-JP0179-EXP','M',8), ('p-exp-JP0179-EXP','L',8), ('p-exp-JP0179-EXP','XL',2),
  -- Adult All Weather Jacket, Navy — 5
  ('p-exp-KB3914-EXP','L',3), ('p-exp-KB3914-EXP','XL',1), ('p-exp-KB3914-EXP','2XL',1),
  -- Backpack, Navy — 64
  ('p-exp-5159406-EXP','OSFA',64)
ON CONFLICT (product_id, size) DO UPDATE SET quantity = EXCLUDED.quantity;

-- 3. Base articles: truncate the same penny --------------------------------
-- The 13 base articles these rows were costed from carry the rounded-UP penny on their 35/50/55
-- retails. Cost truncates, so bring them onto the same rule (5 of the 13 actually move). Scoped to
-- this list's articles by SKU — the other 119 rounded-up lockerroom rows are a separate call.
UPDATE products
   SET nsa_cost = floor(retail_price * 0.55 * 0.75 * 100) / 100,
       updated_at = now()
 WHERE pricing_group = 'lockerroom'
   AND id NOT LIKE 'p-exp-%'
   AND sku IN ('JD7373','KB4028','JY5390','JY5395','JD7371','KB4029','KB4042','KE9910',
               'JD7370','KB4032','KB4037','JY5389','KB3914')
   AND retail_price > 0
   AND nsa_cost IS DISTINCT FROM floor(retail_price * 0.55 * 0.75 * 100) / 100;

COMMIT;

-- Verify: 23 catalog rows, 1,656 units on hand across 22 SKUs.
-- select count(*) from products where id like 'p-exp-%';
-- select sum(quantity) from product_inventory where product_id like 'p-exp-%';
