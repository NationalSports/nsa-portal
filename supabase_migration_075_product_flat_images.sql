-- Product-only ("form"/"flat", no model) photos scraped from sanmar.com product
-- pages by netlify/functions/sanmar-flat-images-background.js. SanMar's SOAP feed
-- exposes only the single model shot, so these live in their own columns.
--
-- The trigger makes the flat photo win everywhere without touching any reader:
-- whenever a row carrying a flat URL is written, image_front_url/image_back_url
-- are repointed at it. The nightly SanMar catalog syncs upsert the model-shot URL
-- into image_front_url on every run — on those upserts the flat columns aren't in
-- the SET list, so NEW keeps the stored flat values and the trigger restores the
-- flat photo. Clearing image_flat_front_url (set null) opts a product back into
-- model photography at the next sync.
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_flat_front_url TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_flat_back_url TEXT;

CREATE OR REPLACE FUNCTION products_prefer_flat_images() RETURNS trigger AS $$
BEGIN
  IF NEW.image_flat_front_url IS NOT NULL THEN
    NEW.image_front_url := NEW.image_flat_front_url;
  END IF;
  IF NEW.image_flat_back_url IS NOT NULL THEN
    NEW.image_back_url := NEW.image_flat_back_url;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_prefer_flat_images ON products;
CREATE TRIGGER trg_products_prefer_flat_images
  BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION products_prefer_flat_images();

-- Per-style scrape state: lets the background function converge over multiple
-- runs and skip styles already checked (including ones with no form photos on
-- sanmar.com, so they aren't rescraped every run).
CREATE TABLE IF NOT EXISTS sanmar_flat_state (
  style TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  colors_found INT NOT NULL DEFAULT 0,
  products_updated INT NOT NULL DEFAULT 0,
  note TEXT
);
ALTER TABLE sanmar_flat_state ENABLE ROW LEVEL SECURITY;
