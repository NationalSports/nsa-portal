-- Traceability: when staff build a draft estimate from a roster session, stamp
-- the estimate's id on the session so "did our order go in?" has an answer.
-- Null for sessions that haven't been turned into an estimate yet.
ALTER TABLE public.roster_order_sessions ADD COLUMN IF NOT EXISTS estimate_id text;
