-- Coach store builder: store-origin flag + the allow-list fallback pool config.
--
-- Lets a coach self-serve build a team store from their own portal. Two pieces:
--   1. webstores.created_via — marks who built a store ('staff' default, 'coach'
--      for self-serve submissions) so staff can spot coach drafts awaiting review.
--   2. coach_store_config — a single tunable config row that defines the FALLBACK
--      item pool used when no template exists: coaches may only choose in-stock
--      items from these brands/categories (empty array = no restriction on that
--      facet). When a template IS set, the template's items/prices govern instead.
--
-- The coach portal is public (anon), so the config is readable by anon; only the
-- service role (the coach-store-submit edge function) ever writes store rows.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS created_via TEXT DEFAULT 'staff';

CREATE TABLE IF NOT EXISTS coach_store_config (
  id                 INTEGER PRIMARY KEY DEFAULT 1,
  allowed_brands     TEXT[]  NOT NULL DEFAULT '{}',
  allowed_categories TEXT[]  NOT NULL DEFAULT '{}',
  default_fundraise  NUMERIC NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coach_store_config_singleton CHECK (id = 1)
);

-- Seed a sensible default pool (Adidas, any category, no fundraising add-on).
-- Staff can tighten this, or better, curate a template for full control.
INSERT INTO coach_store_config (id, allowed_brands, allowed_categories, default_fundraise)
VALUES (1, ARRAY['Adidas'], ARRAY[]::TEXT[], 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE coach_store_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coach_store_config_read ON coach_store_config;
CREATE POLICY coach_store_config_read ON coach_store_config FOR SELECT USING (true);
GRANT SELECT ON coach_store_config TO anon, authenticated;
