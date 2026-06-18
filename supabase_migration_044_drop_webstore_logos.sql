-- Drop webstore_logos: superseded by the existing customer art library.
--
-- The store builder now sources art from customers.art_files (the same library
-- used for order artwork), rather than a siloed per-store upload table. Applied
-- art still lives denormalized on webstore_products.decorations (kept), and
-- recolored variants are saved back onto customers.art_files for reuse across
-- stores and order mockups.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

DROP TABLE IF EXISTS webstore_logos;
