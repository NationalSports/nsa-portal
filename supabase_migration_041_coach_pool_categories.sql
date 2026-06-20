-- Curate the coach self-serve allow-list pool.
--
-- The fallback pool (used when no template is set) was "any in-stock item from
-- the allowed brands" — which surfaced socks, balls, underwear, loose SKUs, etc.
-- Scope it to the apparel/accessory categories that actually belong in a team
-- spirit store so the default coach experience feels curated, not a data dump.
-- Staff can still widen/narrow this row at any time.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

UPDATE coach_store_config
SET allowed_categories = ARRAY['Tees','Hoods','Shorts','Polos','Pants','1/4 Zips','Crew','Outerwear','Jersey','Hats','Bags'],
    updated_at = now()
WHERE id = 1;
