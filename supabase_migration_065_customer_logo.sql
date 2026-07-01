-- School / customer logo, shown in the coach-portal hero ("Team HQ").
--
-- Uploaded per customer from CustDetail → Catalog Access (Cloudinary URL). The
-- coach portal falls back to a team-color monogram badge when this is empty, so
-- it's optional and additive — no other behavior depends on it.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS logo_url text;
