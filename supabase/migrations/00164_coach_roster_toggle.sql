-- Per-customer switch for the coach-portal roster module. Off by default so the
-- roster section only appears for accounts staff explicitly opt in (matches the
-- coach_ai_builder / coach_livelook / coach_build_orders pattern from 00145).
-- Gates RosterOrdersCoach in the portal; staff still manage rosters from the
-- customer's Roster tab regardless.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS coach_roster BOOLEAN DEFAULT false;
