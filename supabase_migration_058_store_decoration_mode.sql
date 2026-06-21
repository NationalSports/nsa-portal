-- Store-level decoration mode.
--
-- Whether NSA decorates a store's orders in-house or it's decorated elsewhere drives
-- how strict the artwork needs to be:
--   • in_house   — we print/embroider it, so every logo needs production-ready art
--                  (separations / vector) connected to the customer's art folder.
--   • outsourced — decorated off-site, so a clean PNG/AI mockup is enough; it's still
--                  saved to the customer's art library so it can be upgraded to real
--                  decoration art (seps/vector) and reused on future stores.
--
-- Chosen as a question when the store is created (store-level only). Default in_house,
-- which is the common case. Internal ops field — not exposed on webstores_public.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS decoration_mode text NOT NULL DEFAULT 'in_house';
