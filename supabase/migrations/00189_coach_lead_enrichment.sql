-- coach_leads enrichment columns — Phase 2 of the auto-store-creation program.
--
-- coach-leads-enrich.js web-searches each new lead's school for its team colors +
-- mascot (Haiku) and writes suggestions back. `enrichment` holds the full AI payload
-- (color names, hex, mascot, confidence, sources); `colors` continues to hold the
-- catalog-color-family name array the store builder consumes. Logos stay manual
-- (staff set logo_url), so this migration never touches it. See
-- COACH_AUTO_STORE_PLAN_2026-07-10.md Phase 2.
--
-- No RLS changes: coach_leads is already staff-only (see 00188_coach_leads.sql).

alter table public.coach_leads add column if not exists enrichment jsonb;
alter table public.coach_leads add column if not exists enriched_at timestamptz;
