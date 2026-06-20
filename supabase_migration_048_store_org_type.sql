-- Persist the store builder's Team vs Club choice.
--
-- The builder has a Team/Club toggle that relabels the form (Coach vs Director)
-- and changes how jersey numbers are configured (team = per-item in the Catalog;
-- club = a store-wide numbering section). It was client-only, so editing a store
-- always reopened as "team" and could overwrite a club's saved numbering config.
-- Persisting it makes the distinction durable and the edit non-destructive.
--
-- Defaults to 'team' (the common case); existing rows become 'team', which matches
-- their prior client-side default.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS org_type text DEFAULT 'team';
