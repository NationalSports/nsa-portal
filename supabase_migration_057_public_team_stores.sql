-- Public "Team Stores" directory flag.
--
-- nationalsportsapparel.com/team-stores is a public portal that lists the open
-- team stores (proxied to the portal's /team-stores page the same way /livelook
-- is). This adds a per-store opt-out:
--   • webstores.public_listed (default true) — show this store on the public
--     directory. Every existing store defaults in; a rep can uncheck it while
--     building a store to keep it private/unlisted.
--
-- Exposed on webstores_public (the anon-readable store view) so the directory can
-- list open + listed stores. Additive (column appended; view recreated with the
-- same column set plus public_listed).
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS public_listed boolean NOT NULL DEFAULT true;

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
    public_listed
   FROM webstores
  WHERE status <> 'archived'::text;
