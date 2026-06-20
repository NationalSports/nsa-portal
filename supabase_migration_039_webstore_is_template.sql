-- Store templates.
--
-- Adds webstores.is_template: flags a store as a reusable starting point. The
-- existing duplicate flow ("New from template") clones a template's catalog,
-- packages and transfer setup into a fresh draft store. Additive and
-- backward-compatible (defaults false).
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;
