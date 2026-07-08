-- Per-player roster links for club stores.
--
-- webstore_roster already tracked players (name / number / parent_email) and an
-- `ordered` flag, but nothing populated it: there was no way to add players, no
-- per-player link, and `ordered` was never set true anywhere. This migration
-- turns the roster into a working "who has / hasn't ordered" tracker with a
-- unique link per player.
--
--   token      — url-safe per-player link id. The storefront resolves
--                /shop/<slug>?player=<token> to greet the player and prefill
--                their name / number; checkout marks their row ordered.
--   ordered_at — when the player's order was placed (audit + sorting).
--   order_id   — the webstore_orders row that fulfilled the player (nullable;
--                cleared if that order is ever deleted).
--
-- RLS is unchanged: webstore_roster stays authenticated-only (staff portal +
-- coach magic-link sessions manage it). Anon never touches the base table — the
-- public storefront resolves tokens and flips `ordered` through the service-role
-- webstore-checkout function (roster_lookup / place_order), exactly like every
-- other public store read/write.

ALTER TABLE public.webstore_roster
  ADD COLUMN IF NOT EXISTS token      text,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_id   uuid REFERENCES public.webstore_orders(id) ON DELETE SET NULL;

-- Backfill a token for every existing player (32 hex chars, url-safe). New rows
-- get their token from the app at insert time; this only covers legacy rows.
UPDATE public.webstore_roster
   SET token = replace(gen_random_uuid()::text, '-', '')
 WHERE token IS NULL;

-- One link per player, and the storefront's lookup path (store_id + token) is
-- indexed so token resolution stays cheap as rosters grow.
CREATE UNIQUE INDEX IF NOT EXISTS idx_webstore_roster_token       ON public.webstore_roster(token);
CREATE INDEX        IF NOT EXISTS idx_webstore_roster_store_token ON public.webstore_roster(store_id, token);
