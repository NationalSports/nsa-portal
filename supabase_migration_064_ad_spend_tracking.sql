-- Athletic-director "Team Spend & Promo" dashboard toggle.
--
-- Gates an optional, AD-facing section in the coach portal that shows per-team
-- spend (products + decoration only — shipping and tax excluded) alongside the
-- account's promo balance. Not every athletic director gets it, so it's an
-- opt-in flag set per parent customer in CustDetail → Catalog Access, the same
-- pattern as coach_ai_builder / coach_livelook / coach_build_orders.
--
-- Only meaningful on parent (athletic-director) accounts — sub-customers (teams)
-- don't roll up other teams — but the column lives on every customer row so the
-- existing select('*') customer load and optimistic toggle helpers pick it up
-- with no other changes.
--
-- Defaults to false (off) so nothing new appears for anyone until a rep enables it.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS ad_spend_tracking boolean DEFAULT false;
