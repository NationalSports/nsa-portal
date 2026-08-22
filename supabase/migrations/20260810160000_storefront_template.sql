-- Storefront template picker: which layout a team store renders.
--   'classic'   — the existing cream/two-column look (default, unchanged)
--   'spotlight' — logo-led hero, oversized display type, live countdown
--
-- Null/absent behaves as 'classic', so every existing store is untouched.
alter table public.webstores
  add column if not exists storefront_template text
    constraint webstores_storefront_template_check
      check (storefront_template is null or storefront_template in ('classic', 'spotlight'));

-- The public storefront reads webstores_public, NOT webstores — a column that
-- isn't in this view is invisible to shoppers. Re-create it with the template
-- (and `sport`, which the Spotlight hero uses for its "SCHOOL · SPORT" eyebrow).
-- Column list is otherwise byte-identical to the previous definition.
create or replace view public.webstores_public as
  select id,
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
    processing_pct,
    storefront_template,
    sport
  from webstores
  where status <> 'archived'::text;
