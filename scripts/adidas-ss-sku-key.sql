-- Emits the S&S ↔ adidas SKU key as one JSON document, for
-- scripts/build-adidas-ss-key-pdf.js to render into the decorator's printed key.
--
-- The crosswalk itself lives in the adidas_ss_sku_xref VIEW
-- (supabase/migrations/20260826140000_adidas_ss_sku_xref.sql) so the printed key
-- and the SKU we write onto Silver Screen's portal order can never drift apart.
-- Change the family map or the colour matching there, not here.
--
--   psql "$SUPABASE_DB_URL" -Aqt -f scripts/adidas-ss-sku-key.sql > key.json
--   node scripts/build-adidas-ss-key-pdf.js key.json "adidas-S&S SKU Key.pdf"

select coalesce(json_agg(json_build_object(
         'st', style,
         'ss', ss_sku,
         'sn', ss_name,
         'sc', ss_colour,
         'sz', ss_sizes,
         'ar', articles
       ) order by style, ss_sku), '[]'::json)::text
from (
  select style, ss_sku, ss_name, ss_colour, ss_sizes,
         coalesce(
           json_agg(json_build_object('a', adidas_article, 'n', adidas_name,
                                      'c', adidas_colour, 'q', in_house_qty,
                                      'cur', is_current, 'vs', vendor_stock)
                    order by rank)
             filter (where adidas_article is not null),
           '[]'::json) as articles
  from adidas_ss_sku_xref
  group by style, ss_sku, ss_name, ss_colour, ss_sizes
) t;
