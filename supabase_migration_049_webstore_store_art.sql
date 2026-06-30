-- Curated per-store art set.
--
-- The store builder aggregates the customer's FULL art library (their saved art plus
-- every art file off their sales orders & estimates). That's the right pool to choose
-- from, but staff don't want all of it offered when decorating items — they want to
-- pick the handful that belongs on THIS store. store_art holds that curated subset
-- (an array of art records: { id, name, preview_url/files, _srcLabel, … }). The
-- per-item logo picker draws from store_art; the Art & Logos tab curates it.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS store_art jsonb NOT NULL DEFAULT '[]'::jsonb;
