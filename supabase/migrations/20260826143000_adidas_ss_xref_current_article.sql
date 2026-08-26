-- Rank the CURRENT adidas article first, and stop duplicating the family map.
--
-- Two problems with the first cut, both found by Steve reading the printed key:
--
-- 1. WRONG ARTICLE ON THE DECO PO. rank=1 was "the article we hold the most of
--    in house", but in-house stock skews to OLD season goods — we still hold 21
--    black fleece hoods under HR8470 while the article S&S actually ships today
--    is JW6602. So the deco PO put a discontinued number on Silver Screen's
--    order: the exact failure this whole feature exists to prevent.
--
--    The vendor feed separates the two cleanly. Articles adidas/S&S still carry
--    have live stock and a current sync date; discontinued ones sit at zero with
--    a stale one. Across the 165 links: 121 have live vendor stock (all I/J/K
--    prefixes), and the dead ones are almost entirely H-prefix. So rank now
--    orders by "is the vendor still shipping it", which moves 7 of 123 picks —
--    every one of them from an H-prefix article to a current J/K one.
--
--    In-house quantity stays as a tie-break only. It answers "what did we buy
--    once", not "what will arrive at the decorator next".
--
-- 2. THE FAMILY MAP WAS INLINE IN THE VIEW. Replacing the view meant copying all
--    fifty-odd rows into a second migration, leaving two copies to hand-sync —
--    the exact trap this repo already carries too much of. The map is data, not
--    schema, so it moves into a table: adding a garment family is now an INSERT,
--    not a migration, and there is one copy of it.

create table if not exists public.adidas_ss_family_map (
  style       text not null,   -- S&S style number, e.g. AT101
  adidas_name text not null,   -- a products.name for the SAME garment body
  note        text,
  primary key (style, adidas_name)
);

comment on table public.adidas_ss_family_map is
  'S&S style number to the adidas catalog name(s) for the same garment. Curated: our adidas rows carry several names per garment across seasons and import sources ("Adidas Unisex Pregame Tee", "Adidas Pregame T-Shirt", "...Pregame BOS Short Sleeve Tee" are one tee — BOS is the Badge of Sport logo, not a different body). Feeds adidas_ss_sku_xref.';

-- Seed = the list that was inline in 20260826140000. Idempotent, so re-running is safe.
insert into public.adidas_ss_family_map (style, adidas_name) values
  ('AT101','Adidas Unisex Pregame Tee'),
  ('AT101','Adidas Pregame T-Shirt'),
  ('AT101','Adidas Men''s Pregame BOS Short Sleeve Tee'),
  ('AT101','Adidas 25 TEAM Pregame Tee'),
  ('AT101','Adidas 25 TEAM PREGAME MEL Tee'),
  ('AT101','Adidas Pregame Tee'),
  ('AT102','Adidas W SS Pregame'),
  ('AT104','Adidas LS Pregame Tee'),
  ('AT104','Adidas Pregame Long Sleeve T-Shirt'),
  ('AT104','Adidas Men''s Pregame BOS Long Sleeve Tee'),
  ('AT105','Adidas W LS Pregame'),
  ('AT106','Adidas M FRESH SS T A'),
  ('AT106','Adidas M FRESH SS T B'),
  ('AT106','Adidas Men''s Fresh BOS Short Sleeve Tee'),
  ('AT107','Adidas W FRESH SS Tee'),
  ('AT108','Adidas M FRESH LS T A'),
  ('AT108','Adidas Men''s Fresh BOS Long Sleeve Tee'),
  ('AT109','Adidas W FRESH LS Tee'),
  ('AT115','Adidas Entrada26 Jersey HS'),
  ('AT315','Adidas Entrada26 ShortHS'),
  ('AT120','Adidas Quickset SL W'),
  ('AT130','Adidas Techfit SS Tee'),
  ('AT130','Adidas Men''s Techfit Short Sleeve Tee'),
  ('AT310','Adidas Techfit VB Shorts W'),
  ('AT750','Adidas Techfit BRA'),
  ('AT200','Adidas M Fleece Crew'),
  ('AT202','Adidas Y Fleece Crew'),
  ('AT203','Adidas Fleece Hood'),
  ('AT204','Adidas W Fleece Hood'),
  ('AT205','Adidas Y Fleece Hood'),
  ('AT215','Adidas M Fleece Pant'),
  ('AT216','Adidas W Fleece Pant'),
  ('AT216','Adidas W. Fleece Pant'),
  ('AT217','Adidas Y Fleece Pant'),
  ('AT208','Adidas Game&Go Full Zip Hood'),
  ('AT209','Adidas W Game&Go Full Zip Hood'),
  ('AT218','Adidas Game&Go Pant'),
  ('AT219','Adidas W Game&Go Pant'),
  ('AT220','Adidas M Z.N.E. Full Zip'),
  ('AT221','Adidas W Z.N.E. Full Zip'),
  ('AT222','Adidas M Z.N.E. Pant'),
  ('AT223','Adidas W Z.N.E. Pant'),
  ('AT300','Adidas M 3 Stripe 7IN Short'),
  ('AT301','Adidas W 3 Stripe 3IN Short'),
  ('AT302','Adidas YOUTH 3 Stripe Short'),
  ('AT400','Adidas 3 Stripe LS 1/4 ZIP'),
  ('AT401','Adidas W 3 Stripe LS 1/4 ZIP'),
  ('AT304','Adidas M D4T W Short'),
  ('AT500','Adidas Tiro Woven Track Top'),
  ('AT501','Adidas Tiro W Woven Top'),
  ('AT600','Adidas DOWN PUF Hood Jacket')
on conflict (style, adidas_name) do nothing;

alter table public.adidas_ss_family_map enable row level security;
drop policy if exists adidas_ss_family_map_read on public.adidas_ss_family_map;
create policy adidas_ss_family_map_read on public.adidas_ss_family_map for select to authenticated using (true);
revoke all on public.adidas_ss_family_map from anon;
grant select on public.adidas_ss_family_map to authenticated, service_role;

-- Dropped rather than replaced: the view gains vendor_stock/is_current columns,
-- and CREATE OR REPLACE VIEW cannot add a column mid-list. Nothing depends on it
-- but the Silver Screen job function, which resolves it by name at query time.
drop view if exists public.adidas_ss_sku_xref;

create view public.adidas_ss_sku_xref
with (security_invoker = true) as
with family as (select style, adidas_name from public.adidas_ss_family_map),

-- "Is the vendor still shipping this article?" — the signal that tells a current
-- article from a superseded one. Summed across every feed (S&S, adidas B2B), so
-- any live source counts.
vendor as (select sku, sum(stock_qty) as vendor_stock from adidas_inventory group by sku),

ss as (
  select regexp_replace(p.sku,'-[^-]*$','') as style, p.sku as ss_sku, p.name as ss_name,
         p.color as ss_colour, p.available_sizes as ss_sizes, public._adidas_ckey(p.color) as ck
  from products p where p.id like 'ssa-%'
),
ad as (
  select p.sku as adidas_article, p.name as adidas_name, p.color as adidas_colour,
         public._adidas_ckey(p.color) as ck,
         coalesce(v.vendor_stock, 0) as vendor_stock,
         coalesce((select sum(i.quantity) from product_inventory i where i.product_id = p.id), 0) as in_house_qty
  from products p
  left join vendor v on v.sku = p.sku
  where p.sku ~ '^[A-Z]{2}[0-9]{4}$'
    and p.name in (select adidas_name from family)
)
select ss.style, ss.ss_sku, ss.ss_name,
       regexp_replace(regexp_replace(ss.ss_name, '\s*\(AT[0-9]+\)\s*$', ''), '^Adidas\s+', '') as garment,
       ss.ss_colour, ss.ss_sizes,
       ad.adidas_article, ad.adidas_name, ad.adidas_colour,
       ad.vendor_stock,
       -- Current = the vendor is still shipping it. Everything else is a number
       -- that can legitimately still turn up on a tag from older stock.
       (ad.vendor_stock > 0) as is_current,
       ad.in_house_qty,
       row_number() over (partition by ss.ss_sku
                          order by (ad.vendor_stock > 0) desc,
                                   ad.vendor_stock desc,
                                   ad.in_house_qty desc nulls last,
                                   ad.adidas_article desc) as rank
from ss
-- LATERAL, not a flat join through `family`: a style maps to several adidas names,
-- so joining them flat emits one NULL row per name that missed on colour.
left join lateral (
  select ad.* from ad
  join family f on f.adidas_name = ad.adidas_name and f.style = ss.style
  where ad.ck = ss.ck
) ad on true
where ss.style in (select distinct style from family);

comment on view public.adidas_ss_sku_xref is
  'S&S style+colour to adidas article number. rank=1 is the article the vendor is still shipping (is_current), which is what a new order will arrive tagged with; in-house quantity is only a tie-break. adidas_article is null where no counterpart is catalogued yet.';

revoke all on public.adidas_ss_sku_xref from anon;
grant select on public.adidas_ss_sku_xref to authenticated, service_role;
