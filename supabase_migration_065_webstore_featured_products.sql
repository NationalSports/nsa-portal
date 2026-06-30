-- 065 · Curated featured items for the club-store hero collage.
--
-- featured_product_ids drives the storefront hero collage (HeroOpen):
--   NULL  → auto: the store's first 3 in-stock products (default / back-compat)
--   '[]'  → none: hide the collage entirely
--   '[id1,id2,id3]' → those webstore_product ids, in order (max 3 shown)
--
-- Per store; independent of any other store's selection.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS featured_product_ids jsonb;

-- Expose the new column to the anon storefront via webstores_public.
-- Appended last so CREATE OR REPLACE keeps the existing column order.
CREATE OR REPLACE VIEW webstores_public AS
 SELECT id,
    slug,
    name,
    status,
    open_at,
    close_at,
    payment_mode,
    require_login,
    number_enabled,
    number_unique,
    number_min,
    number_max,
    fundraise_enabled,
    fundraise_show_parents,
    logo_url,
    banner_url,
    primary_color,
    accent_color,
    hero_blurb,
    theme,
    ship_home_enabled,
    deliver_club_enabled,
    delivery_mode,
    flat_shipping,
    public_listed,
    featured_product_ids
   FROM webstores
  WHERE status <> 'archived'::text;
