-- Expose processing_pct on the public storefront view.
--
-- The storefront reads the store from webstores_public (Storefront.js:287) and
-- computes the checkout processing fee from store.processing_pct (Storefront.js:34).
-- That column was not on the view, so the client fee resolved to $0 while the
-- server (webstore-checkout.js procFee) charged the real percentage — the pre-tax
-- drift guard then rejected every card order with 409 totals_changed. All stores
-- currently run the 5% default, so card checkout was blocked on every store.
--
-- Recreated exactly as-is with processing_pct appended (CREATE OR REPLACE requires
-- the existing column list to be unchanged and additions only at the end).

CREATE OR REPLACE VIEW public.webstores_public AS
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
    featured_product_ids,
    processing_pct
   FROM webstores
  WHERE status <> 'archived'::text;
