-- Roster engagement: track whether a player has opened their link, and drive an
-- automatic reminder when they haven't.
--
-- The club hands each player a private link (migration 00161). To chase the ones
-- who never engage, we record when the link is first/last opened and how many
-- times, plus when an invite email was sent — so a scheduled sweep can nudge any
-- player who was invited but hasn't opened their link (and hasn't ordered).
--
--   first_opened_at / last_opened_at / open_count — set by the storefront's
--     roster_lookup (service role) each time the player loads their link.
--   invite_sent_at / invite_count — set when a link email goes out (initial
--     invite or a manual resend).
--   reminder_sent_at — set once the auto-reminder has fired, so it never repeats.
--
-- Anon never writes these — only the service-role checkout function (opens) and
-- the invite/sweep functions (invites/reminders) touch the table.

ALTER TABLE public.webstore_roster
  ADD COLUMN IF NOT EXISTS first_opened_at  timestamptz,
  ADD COLUMN IF NOT EXISTS last_opened_at   timestamptz,
  ADD COLUMN IF NOT EXISTS open_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invite_sent_at   timestamptz,
  ADD COLUMN IF NOT EXISTS invite_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- The reminder sweep scans for: invited, never opened, not ordered, not yet
-- reminded. A partial index keeps that scan cheap as rosters grow.
CREATE INDEX IF NOT EXISTS idx_webstore_roster_reminder_due
  ON public.webstore_roster (invite_sent_at)
  WHERE reminder_sent_at IS NULL AND last_opened_at IS NULL AND ordered = false;
