-- Automated follow-up emails for estimates, invoices, and art (so_jobs).
--
-- Before this, `follow_up_at` was purely a client-side TODO reminder: the rep had
-- to open the portal, see the "Follow Up" nudge, and manually re-send. These
-- columns turn follow-ups into a hands-off scheduler (netlify/functions/followup-sweep.js):
-- the rep sets a schedule + a custom follow-up message when they send the initial
-- email, and the server sends the follow-ups automatically until the doc is
-- resolved (approved / paid / art approved-or-rejected) or a max count is hit.
--
--   follow_up_auto          — automation on/off (opt-in per doc)
--   follow_up_at (existing)  — when the NEXT auto follow-up should go out
--   follow_up_interval_days — repeat cadence; NULL/0 = one-time follow-up
--   follow_up_message       — custom body for the follow-up (distinct from the initial email)
--   follow_up_to            — recipient emails captured at send time (comma-separated)
--   follow_up_count         — how many auto follow-ups have been sent
--   follow_up_max           — safety cap so nobody is emailed forever
--   follow_up_last_sent_at  — audit of the most recent auto send

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estimates','invoices','so_jobs']
  LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS follow_up_auto boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS follow_up_interval_days integer,
      ADD COLUMN IF NOT EXISTS follow_up_message text,
      ADD COLUMN IF NOT EXISTS follow_up_to text,
      ADD COLUMN IF NOT EXISTS follow_up_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS follow_up_max integer,
      ADD COLUMN IF NOT EXISTS follow_up_last_sent_at text', t);
  END LOOP;
END $$;

-- The sweep scans for due auto follow-ups; partial indexes keep it cheap.
CREATE INDEX IF NOT EXISTS idx_estimates_followup_due ON public.estimates (follow_up_at) WHERE follow_up_auto;
CREATE INDEX IF NOT EXISTS idx_invoices_followup_due  ON public.invoices  (follow_up_at) WHERE follow_up_auto;
CREATE INDEX IF NOT EXISTS idx_so_jobs_followup_due   ON public.so_jobs   (follow_up_at) WHERE follow_up_auto;
