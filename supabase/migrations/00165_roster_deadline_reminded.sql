-- Track when a deadline reminder was sent for a roster-order session so the daily
-- scheduled function (roster-deadline-reminders) nags coaches at most once per
-- session as the deadline approaches, instead of every day.
ALTER TABLE public.roster_order_sessions ADD COLUMN IF NOT EXISTS deadline_reminded_at timestamptz;
