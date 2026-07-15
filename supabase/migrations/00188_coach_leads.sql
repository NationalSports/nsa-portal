-- coach_leads: intake funnel for the auto-store-creation program.
--
-- One row per prospective coach (new hire / cold list / manual entry) working toward
-- a fully branded team store. Filled today by the scheduled Google Sheet sync
-- (netlify/functions/coach-leads-sheet-sync.js); later by CSV import and a "New Coaches"
-- admin screen. See COACH_AUTO_STORE_PLAN_2026-07-10.md Phase 1 item 1 — this revives the
-- previously-orphaned `coach_hire_leads` concept referenced in the RLS docs, with a proper
-- CREATE TABLE this time.
--
-- funnel: new → enriched → ready → store_built → emailed → claimed
--   new          — just landed (sheet/csv/manual), unreviewed
--   enriched     — logo/colors/sport filled in (manual or future automation)
--   ready        — reviewed, ready for a rep to click "Build store"
--   store_built  — customer + draft webstore created, staff publish pending
--   emailed      — congrats/launch email sent, coach invited
--   claimed      — coach has logged into their portal
create table if not exists public.coach_leads (
  id          uuid primary key default gen_random_uuid(),

  name        text,
  -- Writers (sheet sync, CSV import, manual entry) normalize to trim+lowercase before
  -- writing here — the unique constraint depends on that, not on DB-side normalization.
  email       text not null unique,
  phone       text,

  school      text,
  sport       text,

  -- Where this lead came from: 'sheet' | 'manual' | 'csv' | 'hire_feed' | 'cold_list'
  source      text not null default 'manual',
  -- Funnel stage — see comment above: new → enriched → ready → store_built → emailed → claimed
  status      text not null default 'new',

  logo_url    text,
  colors      jsonb,

  -- customers.id is TEXT in this schema (see 00007_app_schema_alignment.sql) — not uuid.
  customer_id text references public.customers(id),
  webstore_id uuid references public.webstores(id),

  notes       text,
  -- Original sheet/CSV row, keyed by source header, for columns we don't map to a column above.
  raw         jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Staff-only, no anon access ever — this table is lead PII (name/email/phone). Exact
-- pattern as 00182_quote_tables_staff_only.sql. The service role (used by the sheet sync
-- function and future store-quick-build function) bypasses RLS entirely.
alter table public.coach_leads enable row level security;

create policy coach_leads_staff_all on public.coach_leads
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());

revoke select, insert, update, delete on public.coach_leads from anon;
