-- adidas ↔ S&S SKU cross-reference.
--
-- We buy adidas Team goods through S&S Activewear under S&S style numbers
-- (AT101-50), and S&S ships them WITHOUT re-tagging — so the garment that reaches
-- the decorator carries adidas' own article number (JX4452). Packing slips said
-- one thing and the tag said another, and Silver Screen could not confirm a piece
-- was right (Trinity Lyle, 2026-08-25). This view is the crosswalk: it feeds both
-- the printed key we send the decorator (scripts/build-adidas-ss-key-pdf.js) and
-- the SKU we write onto their portal order (netlify/functions/silverscreen-job.js).
--
-- The two catalogs share no key, so the join is (garment family) × (colour):
--   FAMILY — a curated map from S&S style number to the adidas catalog name(s) for
--     the same body. Curated because our adidas rows carry several names per
--     garment across seasons and import sources: "Adidas Unisex Pregame Tee",
--     "Adidas Pregame T-Shirt" and "Adidas Men's Pregame BOS Short Sleeve Tee" are
--     all the same tee (BOS is the Badge of Sport logo, not a different body).
--   COLOUR — the normalised BASE colour. The two sides write colour differently
--     ("Black/ White" vs "Black/White" vs "Black / Black") and "Team"/"Collegiate"
--     are decorative; the trim colour after the slash is recorded too
--     inconsistently to match on.
--
-- One S&S style+colour legitimately yields SEVERAL articles — adidas issues a new
-- article number each season for the same garment in the same colour. `rank` puts
-- the article we actually hold in stock first, so a consumer that needs exactly one
-- (the deco PO) takes rank = 1 while the printed key can list them all.

-- Colour key shared by both sides of the join: drop spacing around the slash and
-- the decorative "Team"/"Collegiate" prefixes, keep the BASE (body) colour, then
-- fold the handful of spellings that differ only by wording between the catalogs.
create or replace function public._adidas_ckey(c text)
returns text language sql immutable parallel safe as $fn$
  select case k
           when 'navy blue'            then 'navy'
           when 'royal blue'           then 'royal'
           when 'heather grey'         then 'grey heather'
           when 'medium grey heather'  then 'grey heather'
           else k
         end
  from (select split_part(
                 regexp_replace(
                   lower(regexp_replace(regexp_replace(coalesce(c,''), '\s*/\s*', '/', 'g'), '\s+', ' ', 'g')),
                   '(team |collegiate |colleg )', '', 'g'),
                 '/', 1) as k) t;
$fn$;

create or replace view public.adidas_ss_sku_xref
with (security_invoker = true) as
with family(style, ad_name) as (values
  -- Pregame — short sleeve
  ('AT101','Adidas Unisex Pregame Tee'),
  ('AT101','Adidas Pregame T-Shirt'),
  ('AT101','Adidas Men''s Pregame BOS Short Sleeve Tee'),
  ('AT101','Adidas 25 TEAM Pregame Tee'),
  ('AT101','Adidas 25 TEAM PREGAME MEL Tee'),
  ('AT101','Adidas Pregame Tee'),
  ('AT102','Adidas W SS Pregame'),
  -- Pregame — long sleeve
  ('AT104','Adidas LS Pregame Tee'),
  ('AT104','Adidas Pregame Long Sleeve T-Shirt'),
  ('AT104','Adidas Men''s Pregame BOS Long Sleeve Tee'),
  ('AT105','Adidas W LS Pregame'),
  -- Fresh
  ('AT106','Adidas M FRESH SS T A'),
  ('AT106','Adidas M FRESH SS T B'),
  ('AT106','Adidas Men''s Fresh BOS Short Sleeve Tee'),
  ('AT107','Adidas W FRESH SS Tee'),
  ('AT108','Adidas M FRESH LS T A'),
  ('AT108','Adidas Men''s Fresh BOS Long Sleeve Tee'),
  ('AT109','Adidas W FRESH LS Tee'),
  -- Entrada 26
  ('AT115','Adidas Entrada26 Jersey HS'),
  ('AT315','Adidas Entrada26 ShortHS'),
  -- Quickset
  ('AT120','Adidas Quickset SL W'),
  -- Techfit
  ('AT130','Adidas Techfit SS Tee'),
  ('AT130','Adidas Men''s Techfit Short Sleeve Tee'),
  ('AT310','Adidas Techfit VB Shorts W'),
  ('AT750','Adidas Techfit BRA'),
  -- Fleece — crew / hood / pant
  ('AT200','Adidas M Fleece Crew'),
  ('AT202','Adidas Y Fleece Crew'),
  ('AT203','Adidas Fleece Hood'),
  ('AT204','Adidas W Fleece Hood'),
  ('AT205','Adidas Y Fleece Hood'),
  ('AT215','Adidas M Fleece Pant'),
  ('AT216','Adidas W Fleece Pant'),
  ('AT216','Adidas W. Fleece Pant'),
  ('AT217','Adidas Y Fleece Pant'),
  -- Game & Go
  ('AT208','Adidas Game&Go Full Zip Hood'),
  ('AT209','Adidas W Game&Go Full Zip Hood'),
  ('AT218','Adidas Game&Go Pant'),
  ('AT219','Adidas W Game&Go Pant'),
  -- Z.N.E.
  ('AT220','Adidas M Z.N.E. Full Zip'),
  ('AT221','Adidas W Z.N.E. Full Zip'),
  ('AT222','Adidas M Z.N.E. Pant'),
  ('AT223','Adidas W Z.N.E. Pant'),
  -- 3-Stripes
  ('AT300','Adidas M 3 Stripe 7IN Short'),
  ('AT301','Adidas W 3 Stripe 3IN Short'),
  ('AT302','Adidas YOUTH 3 Stripe Short'),
  ('AT400','Adidas 3 Stripe LS 1/4 ZIP'),
  ('AT401','Adidas W 3 Stripe LS 1/4 ZIP'),
  -- D4T
  ('AT304','Adidas M D4T W Short'),
  -- Tiro
  ('AT500','Adidas Tiro Woven Track Top'),
  ('AT501','Adidas Tiro W Woven Top'),
  -- Outerwear
  ('AT600','Adidas DOWN PUF Hood Jacket')
),

ss as (
  select regexp_replace(p.sku,'-[^-]*$','')  as style,
         p.sku                               as ss_sku,
         p.name                              as ss_name,
         p.color                             as ss_colour,
         p.available_sizes                   as ss_sizes,
         public._adidas_ckey(p.color)        as ck
  from products p
  where p.id like 'ssa-%'
),

ad as (
  select p.sku                        as adidas_article,
         p.name                       as adidas_name,
         p.color                      as adidas_colour,
         public._adidas_ckey(p.color) as ck,
         coalesce((select sum(i.quantity) from product_inventory i where i.product_id = p.id), 0) as in_house_qty
  from products p
  where p.sku ~ '^[A-Z]{2}[0-9]{4}$'
    and p.name in (select ad_name from family)
)

select ss.style,
       ss.ss_sku,
       ss.ss_name,
       -- Display name for the decorator: the S&S name without its "(AT101)" suffix.
       regexp_replace(regexp_replace(ss.ss_name, '\s*\(AT[0-9]+\)\s*$', ''), '^Adidas\s+', '') as garment,
       ss.ss_colour,
       ss.ss_sizes,
       ad.adidas_article,
       ad.adidas_name,
       ad.adidas_colour,
       ad.in_house_qty,
       row_number() over (partition by ss.ss_sku
                          order by ad.in_house_qty desc nulls last, ad.adidas_article desc) as rank
from ss
-- LATERAL, not a plain LEFT JOIN through `family`: a style maps to several adidas
-- names, so joining them flat emits one NULL row per name that did not match the
-- colour, littering every matched SKU with phantom "no article" rows. The lateral
-- yields the matches when there are any, and exactly one NULL row when there are none.
left join lateral (
  select ad.*
  from ad
  join family f on f.ad_name = ad.adidas_name and f.style = ss.style
  where ad.ck = ss.ck
) ad on true
where ss.style in (select distinct style from family);

comment on view public.adidas_ss_sku_xref is
  'S&S style+colour ↔ adidas article number. rank=1 is the article we are most likely shipping (highest in-house stock). adidas_article is null where no counterpart is catalogued yet.';

-- Read-only reference data, but it is derived from products/product_inventory, so
-- keep it off the anonymous role — the storefront has no reason to read cost-bearing
-- stock counts.
revoke all on public.adidas_ss_sku_xref from anon;
grant select on public.adidas_ss_sku_xref to authenticated, service_role;
