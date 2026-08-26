-- Encinitas Express — new product rows for stock the 8/26 sync had nowhere to land
--
-- Follow-up to scripts/sync-encinitas-express-inventory-2026-08-26.sql. Four rows in
-- the sheet's `Express` tab had no `p-exp-*` product, so their counts stayed out of the
-- portal. This creates those products and loads the counts.
--
--   JF2875-EXP  SS Adult GK Jersey   (counted 8/20)
--   JD7358-EXP  SS Youth GK Jersey   (counted 8/18)
--   JF2880-EXP  SS Womens GK Jersey  (counted 8/18)
--   HT6546-EXP  Team Sleeve Sock     (counted 7/27)
--
-- Pricing. Every Encinitas kit product prices at retail = nsa_cost * 2.425 off a
-- round retail ladder. The sheet carries no cost for any Express row, so:
--   · the three GK jerseys copy their long-sleeve siblings — adult/womens $75 / 30.93
--     (JF2881-EXP, JF2871-EXP), youth $70 / 28.87 (JF2887-EXP). ASSUMPTION: the
--     short-sleeve cuts are priced the same as the long-sleeve ones. Confirm and
--     re-price here if the club's list says otherwise.
--   · the sleeve sock takes the figures already on the general-catalog HT6546 row
--     ($16 / 6.60) — not an assumption, the same garment at the same price.
--
-- Size scale follows the convention already used for this club's GK items
-- (JF2887-EXP, JF2872-EXP): the scale is the set of sizes actually counted, not the
-- garment's full run. Youth counts sit in the sheet's XS-XL columns and map to Y*.
--
-- NOT included: the JW6705 socks (navy 155 / red 17). Their size columns in the sheet
-- don't line up with its size header, so which sizes those counts belong to is unclear.
-- Soccer balls are deliberately out of scope.

begin;

insert into public.products
  (id, sku, name, brand, color, category, retail_price, nsa_cost,
   is_active, is_archived, is_clearance, available_sizes, pricing_group, inventory_source)
values
  ('p-exp-JF2875-EXP', 'JF2875-EXP', 'Encinitas Express — Adult GK Jersey SS',
   'Adidas', 'Red', 'Jersey', 75, 30.93, true, false, false,
   '["S","XL"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-JD7358-EXP', 'JD7358-EXP', 'Encinitas Express — Youth GK Jersey SS',
   'Adidas', 'Red', 'Jersey', 70, 28.87, true, false, false,
   '["YS","YM","YL","YXL"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-JF2880-EXP', 'JF2880-EXP', 'Encinitas Express — Womens GK Jersey SS',
   'Adidas', 'Red', 'Jersey', 75, 30.93, true, false, false,
   '["S","M"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-HT6546-EXP', 'HT6546-EXP', 'Encinitas Express — Team Sleeve Sock',
   'Adidas', 'Navy', 'Sport Accessories', 16, 6.60, true, false, false,
   '["OSFA"]'::jsonb, 'lockerroom', 'manual')
on conflict (id) do nothing;

insert into public.product_inventory (product_id, size, quantity)
values
  ('p-exp-JF2875-EXP', 'S',    3),
  ('p-exp-JF2875-EXP', 'XL',   2),
  ('p-exp-JD7358-EXP', 'YS',   4),
  ('p-exp-JD7358-EXP', 'YM',   2),
  ('p-exp-JD7358-EXP', 'YL',   4),
  ('p-exp-JD7358-EXP', 'YXL',  5),
  ('p-exp-JF2880-EXP', 'S',    2),
  ('p-exp-JF2880-EXP', 'M',    2),
  ('p-exp-HT6546-EXP', 'OSFA', 158)
on conflict (product_id, size) do update set quantity = excluded.quantity;

commit;
