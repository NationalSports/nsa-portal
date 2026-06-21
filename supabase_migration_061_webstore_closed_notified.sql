-- Store-close → rep to-do + email: idempotency flag.
--
-- When a webstore closes (either the scheduled sweep flips it past close_at, or a rep
-- closes it manually), we create a rep to-do and email the rep + assigned CSR a breakdown.
-- closed_notified_at is stamped once that's done so the store is never double-processed,
-- no matter which path closed it.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy for the repo's migration history.

ALTER TABLE webstores ADD COLUMN IF NOT EXISTS closed_notified_at timestamptz;
