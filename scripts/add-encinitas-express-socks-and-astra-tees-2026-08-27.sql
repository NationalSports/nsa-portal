-- Encinitas Express — socks + Astra tees, the last Express-tab rows without products
--
-- Third pass, after scripts/sync-encinitas-express-inventory-2026-08-26.sql and
-- scripts/add-encinitas-express-gk-ss-and-socks-2026-08-26.sql. The size scales here
-- were confirmed by staff, resolving the two items the earlier passes left open.
--
--   JW6705-EXP-N / -R   team socks, navy + red   (counted 7/27)
--   AE153Y-EXP          Astra tee, youth         (counted 8/10)
--   AE152-EXP-CB/-N/-R  Astra tee, adult         (counted 8/10)
--
-- Sock sizes were ambiguous in the sheet (counts sat under the main XS-XL header while
-- the block's own label row read "KXXL / KXL"). Staff confirmed the header columns are
-- correct: navy S/M/L, red XS/S. Both colours now reconcile exactly with the sheet's own
-- Total cells (155 and 17), which is what the earlier ambiguity had blocked.
--
-- Astra tee sizes were given as A-prefixed adult sizes (AXS/AS/AM/AL) and map to the
-- portal's plain XS/S/M/L; the AE153Y youth row maps to YS/YM/YL/YXL.
--
-- PRICING. The socks take the figures already on the general-catalog JW6705 row
-- ("Adidas adisock 25 Custom", $25 / 10.31) — same garment, no assumption.
-- The Astra tees are deliberately created with **nsa_cost and retail_price NULL**:
-- AE152/AE153Y appear nowhere else in the catalog, the sheet carries no cost for any
-- Express row, and there is no sibling to inherit from. Guessing a cost on a money path
-- is worse than leaving it unset (693 catalog rows, 361 of them active, already sit this
-- way). Set both when the club's price list is to hand.
--
-- BRAND is also left NULL on the Astra tees. "Astra Sport" is a screen-print decoration
-- vendor elsewhere in this codebase, not a garment label, so the name in the sheet
-- probably refers to who decorated the tee rather than who made it.

begin;

insert into public.products
  (id, sku, name, brand, color, category, retail_price, nsa_cost,
   is_active, is_archived, is_clearance, available_sizes, pricing_group, inventory_source)
values
  ('p-exp-JW6705-EXP-N', 'JW6705-EXP-N', 'Encinitas Express — Team Sock',
   'Adidas', 'Navy', 'Socks', 25, 10.31, true, false, false,
   '["S","M","L"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-JW6705-EXP-R', 'JW6705-EXP-R', 'Encinitas Express — Team Sock',
   'Adidas', 'Red', 'Socks', 25, 10.31, true, false, false,
   '["XS","S"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-AE153Y-EXP', 'AE153Y-EXP', 'Encinitas Express — Astra Tee Youth',
   null, 'Columbia Blue', 'Tees', null, null, true, false, false,
   '["YS","YM","YL","YXL"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-AE152-EXP-CB', 'AE152-EXP-CB', 'Encinitas Express — Astra Tee',
   null, 'Columbia Blue', 'Tees', null, null, true, false, false,
   '["XS","S","M","L"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-AE152-EXP-N', 'AE152-EXP-N', 'Encinitas Express — Astra Tee',
   null, 'Navy', 'Tees', null, null, true, false, false,
   '["M","L"]'::jsonb, 'lockerroom', 'manual'),
  ('p-exp-AE152-EXP-R', 'AE152-EXP-R', 'Encinitas Express — Astra Tee',
   null, 'Red', 'Tees', null, null, true, false, false,
   '["L"]'::jsonb, 'lockerroom', 'manual')
on conflict (id) do nothing;

insert into public.product_inventory (product_id, size, quantity)
values
  ('p-exp-JW6705-EXP-N', 'S',   12),
  ('p-exp-JW6705-EXP-N', 'M',   53),
  ('p-exp-JW6705-EXP-N', 'L',   90),
  ('p-exp-JW6705-EXP-R', 'XS',   6),
  ('p-exp-JW6705-EXP-R', 'S',   11),
  ('p-exp-AE153Y-EXP',   'YS',   2),
  ('p-exp-AE153Y-EXP',   'YM',   1),
  ('p-exp-AE153Y-EXP',   'YL',  19),
  ('p-exp-AE153Y-EXP',   'YXL', 13),
  ('p-exp-AE152-EXP-CB', 'XS',   1),
  ('p-exp-AE152-EXP-CB', 'S',   18),
  ('p-exp-AE152-EXP-CB', 'M',   13),
  ('p-exp-AE152-EXP-CB', 'L',    9),
  ('p-exp-AE152-EXP-N',  'M',   13),
  ('p-exp-AE152-EXP-N',  'L',    7),
  ('p-exp-AE152-EXP-R',  'L',    2)
on conflict (product_id, size) do update set quantity = excluded.quantity;

commit;
