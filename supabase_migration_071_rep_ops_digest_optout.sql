-- Per-rep opt-out for the daily ops recap email (rep-ops-digest).
-- Toggled from Sales Tools → My Day ("Daily email: On/Off"). The digest function
-- reads team_members with select('*') and skips reps where this is true, so it
-- tolerates the column not existing yet (everyone gets the email until applied).
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS ops_digest_opt_out BOOLEAN DEFAULT false;
