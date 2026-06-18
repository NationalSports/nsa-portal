-- Coach fundraising cap.
--
-- Lets a coach add a per-item fundraising amount to their store (the markup that
-- goes back to the team) — bounded by a staff-set ceiling so it can't be abused.
-- The coach-store-submit function clamps the requested amount to this value.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE coach_store_config ADD COLUMN IF NOT EXISTS max_fundraise NUMERIC NOT NULL DEFAULT 25;
