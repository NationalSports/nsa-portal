-- Section templates (bolt-on store sections).
--
-- store_templates already powers "Add template" — a saved set of items (SKUs + price /
-- fundraising / category / kit) that gets added onto a store. This adds two columns so a
-- template can be either:
--   • kind = 'store'   — a full-store template (bolt all its items on). Default; existing
--                        templates are unchanged.
--   • kind = 'section' — a curated bolt-on section (e.g. "Adidas Football Cleats") that
--                        drops every item into one named section/category of the store.
--   • section          — the category a section template lands in (also shown as its label).
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE store_templates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'store';
ALTER TABLE store_templates ADD COLUMN IF NOT EXISTS section text;
