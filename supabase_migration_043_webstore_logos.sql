-- Logo & Art Studio for the store builder.
--
-- Two pieces:
--   1. webstore_logos - a per-store logo/art LIBRARY. Staff upload PNG/SVG/AI;
--      art_url is the on-screen image (PNG/SVG) used for preview + on-garment
--      mocks, source_url keeps the original print-ready file (esp. .ai). Recolor
--      variants are their own rows with parent_id pointing at the base logo.
--   2. webstore_products.decorations - the applied art on each item: a JSONB
--      array of { logo_id, art_url, source_url, placement }. The art_url travels
--      inline so the public storefront can render the mock without reading the
--      (staff-only) library table.
--
-- Staff manage the library while authenticated; the applied art rides on
-- webstore_products (already storefront-readable), so no anon grant is needed here.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

CREATE TABLE IF NOT EXISTS webstore_logos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   uuid NOT NULL,
  parent_id  uuid,                              -- set on recolor variants
  name       text NOT NULL DEFAULT 'Logo',
  art_url    text,                              -- PNG/SVG for preview + mock
  source_url text,                              -- original upload (.ai/.svg/.png)
  kind       text,                              -- 'png' | 'svg' | 'ai' | 'image'
  placement  text DEFAULT 'left_chest',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webstore_logos_store_idx ON webstore_logos(store_id);

ALTER TABLE webstore_products ADD COLUMN IF NOT EXISTS decorations jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE webstore_logos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webstore_logos_auth_all ON webstore_logos;
CREATE POLICY webstore_logos_auth_all ON webstore_logos FOR ALL TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON webstore_logos TO authenticated;
