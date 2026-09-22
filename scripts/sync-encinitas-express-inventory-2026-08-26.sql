-- Encinitas Express (customer c-ns-3978) in-house stock sync — 2026-08-26
--
-- Source: "National Sports Inventory" Google Sheet, `Express` tab (gid 2145104444),
-- physically recounted 2026-08-26. Column alignment was verified against the sheet's
-- own per-row Total column before this file was generated.
--
-- Target: public.product_inventory for the 23 `p-exp-*` products that the Encinitas
-- Express roster kit catalog (roster_kit_templates, is_catalog, customer c-ns-3978)
-- links to. The sheet is a full physical count, so a size the sheet leaves blank is
-- zero on hand, not "unknown" — step 1 zeroes those rather than leaving a stale count.
--
-- Youth rows: the sheet's XS/S/M/L/XL columns are youth sizes and map to the portal's
-- YXS/YS/YM/YL/YXL scale. The backpack's single count sits in the XS column → OSFA.

begin;

create temp table exp_stock (product_id text, size text, qty int) on commit drop;
insert into exp_stock (product_id, size, qty) values
    ('p-exp-JD7373-EXP-W', 'YXS', 2),
    ('p-exp-JD7373-EXP-W', 'YS', 23),
    ('p-exp-JD7373-EXP-W', 'YM', 7),
    ('p-exp-JD7373-EXP-W', 'YL', 27),
    ('p-exp-JD7373-EXP-W', 'YXL', 25),
    ('p-exp-JD7373-EXP-N', 'YXS', 2),
    ('p-exp-JD7373-EXP-N', 'YS', 20),
    ('p-exp-JD7373-EXP-N', 'YM', 6),
    ('p-exp-JD7373-EXP-N', 'YL', 24),
    ('p-exp-JD7373-EXP-N', 'YXL', 25),
    ('p-exp-KB4028-EXP', 'YXS', 10),
    ('p-exp-KB4028-EXP', 'YS', 40),
    ('p-exp-KB4028-EXP', 'YM', 37),
    ('p-exp-KB4028-EXP', 'YL', 3),
    ('p-exp-KB4028-EXP', 'YXL', 29),
    ('p-exp-JY5390-EXP', 'YM', 2),
    ('p-exp-JY5390-EXP', 'YL', 50),
    ('p-exp-JY5390-EXP', 'YXL', 28),
    ('p-exp-JY5395-EXP', 'YXS', 13),
    ('p-exp-JY5395-EXP', 'YS', 21),
    ('p-exp-JY5395-EXP', 'YM', 35),
    ('p-exp-JY5395-EXP', 'YL', 30),
    ('p-exp-JY5395-EXP', 'YXL', 15),
    ('p-exp-JD7371-EXP-W', 'S', 47),
    ('p-exp-JD7371-EXP-W', 'M', 8),
    ('p-exp-JD7371-EXP-W', 'L', 9),
    ('p-exp-JD7371-EXP-W', 'XL', 3),
    ('p-exp-JD7371-EXP-N', 'S', 34),
    ('p-exp-JD7371-EXP-N', 'M', 17),
    ('p-exp-JD7371-EXP-N', 'L', 6),
    ('p-exp-JD7371-EXP-N', 'XL', 4),
    ('p-exp-KB4029-EXP', 'M', 11),
    ('p-exp-KB4029-EXP', 'L', 4),
    ('p-exp-KB4029-EXP', 'XL', 1),
    ('p-exp-KB4042-EXP', 'S', 50),
    ('p-exp-KB4042-EXP', 'M', 30),
    ('p-exp-KB4042-EXP', 'L', 12),
    ('p-exp-KB4042-EXP', 'XL', 2),
    ('p-exp-KB4042-EXP', '2XL', 5),
    ('p-exp-KE9910-EXP', 'S', 20),
    ('p-exp-KE9910-EXP', 'M', 13),
    ('p-exp-KE9910-EXP', 'L', 1),
    ('p-exp-KE9910-EXP', 'XL', 3),
    ('p-exp-KE9910-EXP', '2XL', 5),
    ('p-exp-JD7370-EXP-N', 'XS', 14),
    ('p-exp-JD7370-EXP-N', 'S', 8),
    ('p-exp-JD7370-EXP-N', 'M', 10),
    ('p-exp-JD7370-EXP-N', 'L', 8),
    ('p-exp-JD7370-EXP-W', 'XS', 12),
    ('p-exp-JD7370-EXP-W', 'S', 3),
    ('p-exp-JD7370-EXP-W', 'M', 11),
    ('p-exp-JD7370-EXP-W', 'L', 8),
    ('p-exp-JD7370-EXP-W', 'XL', 4),
    ('p-exp-KB4032-EXP', 'S', 5),
    ('p-exp-KB4032-EXP', 'M', 52),
    ('p-exp-KB4032-EXP', 'L', 9),
    ('p-exp-KB4032-EXP', 'XL', 3),
    ('p-exp-KB4037-EXP', 'S', 7),
    ('p-exp-KB4037-EXP', 'M', 9),
    ('p-exp-KB4037-EXP', 'XL', 2),
    ('p-exp-JY5389-EXP', 'S', 2),
    ('p-exp-JY5389-EXP', 'M', 5),
    ('p-exp-JY5389-EXP', 'L', 2),
    ('p-exp-JY5389-EXP', 'XL', 3),
    ('p-exp-JF2887-EXP', 'YXL', 2),
    ('p-exp-JF2881-EXP', 'S', 7),
    ('p-exp-JF2881-EXP', 'M', 3),
    ('p-exp-JF2881-EXP', 'L', 5),
    ('p-exp-JF2871-EXP', 'S', 7),
    ('p-exp-JF2871-EXP', 'M', 7),
    ('p-exp-JF2871-EXP', 'L', 3),
    ('p-exp-JJ4162-EXP', 'S', 4),
    ('p-exp-JJ4162-EXP', 'M', 4),
    ('p-exp-JJ4162-EXP', 'L', 5),
    ('p-exp-JJ4162-EXP', 'XL', 2),
    ('p-exp-JF2872-EXP', 'YS', 3),
    ('p-exp-JF2872-EXP', 'YL', 16),
    ('p-exp-JF2872-EXP', 'YXL', 1),
    ('p-exp-JP0179-EXP', 'S', 4),
    ('p-exp-JP0179-EXP', 'M', 8),
    ('p-exp-JP0179-EXP', 'L', 8),
    ('p-exp-JP0179-EXP', 'XL', 2),
    ('p-exp-KB3914-EXP', 'L', 3),
    ('p-exp-KB3914-EXP', 'XL', 1),
    ('p-exp-KB3914-EXP', '2XL', 1),
    ('p-exp-5159406-EXP', 'OSFA', 64);

create temp table size_rank (size text, rank int) on commit drop;
insert into size_rank (size, rank) values
    ('YXS', 0),
    ('YS', 1),
    ('YM', 2),
    ('YL', 3),
    ('YXL', 4),
    ('XS', 5),
    ('S', 6),
    ('M', 7),
    ('L', 8),
    ('XL', 9),
    ('2XL', 10),
    ('3XL', 11),
    ('4XL', 12),
    ('OSFA', 13);

-- 1. Sizes on record for these products that the sheet no longer counts → 0 on hand.
update public.product_inventory i
   set quantity = 0
 where i.product_id in (select distinct product_id from exp_stock)
   and not exists (
     select 1 from exp_stock s where s.product_id = i.product_id and s.size = i.size
   )
   and i.quantity <> 0;

-- 2. Upsert the counted quantities.
insert into public.product_inventory (product_id, size, quantity)
select product_id, size, qty from exp_stock
on conflict (product_id, size) do update set quantity = excluded.quantity;

-- 3. Three products were counted in a size outside their recorded scale this pass
--    (navy + white womens jersey XS, white womens jersey XL, womens jacket S).
--    Widen those products' scale so the sizes are orderable, in canonical size order.
update public.products p
   set available_sizes = x.sizes,
       updated_at      = now()
  from (
    select i.product_id, jsonb_agg(i.size order by r.rank) as sizes
      from public.product_inventory i
      join size_rank r on r.size = i.size
     where i.product_id in (select distinct product_id from exp_stock)
     group by i.product_id
  ) x
 where p.id = x.product_id
   and p.available_sizes is distinct from x.sizes;

commit;
