-- Per-rep opt-outs for the rep digest emails.
--   ops_digest_opt_out — the DAILY ops recap (rep-ops-digest), toggled from
--     Sales Tools → My Day ("Daily email: On/Off").
--   ar_digest_opt_out  — the WEEKLY Friday past-due A/R digest (rep-ar-digest).
-- Both functions read team_members with select('*') and skip reps where the flag
-- is true, so they tolerate the columns not existing yet (everyone gets the email
-- until this migration is applied).
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS ops_digest_opt_out BOOLEAN DEFAULT false;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS ar_digest_opt_out BOOLEAN DEFAULT false;
