-- Phase 1 of the CIFCS → Brevo marketing module: the prospect store.
--
-- `marketing_contacts` holds athletic directors + coaches harvested from the
-- public CIFCS school directory (cifcshome.org widget), one row per person/role.
-- It is a PROSPECT list, deliberately separate from `customers`/`customer_contacts`
-- (converted accounts); a prospect that becomes a customer gets `customer_id` set.
--
-- Ingest is done by the service-role Netlify function `cifcs-sync` (which BYPASSES
-- RLS), idempotent on (source, source_ref). No email is ever sent from this phase.
--
-- RLS: staff-only, no anon grants — this is internal sales data. Matches the
-- RLS-lockdown step-1 pattern (00173): reads + writes gated on an active team
-- member via public.is_team_member(). The anon storefront/coach portals never
-- touch this table.

create table if not exists public.marketing_contacts (
  id              uuid primary key default gen_random_uuid(),

  -- Provenance. source_ref is a stable per-person key within a source so re-syncs
  -- update in place instead of duplicating; unique with source below.
  source          text not null default 'cifcs',
  source_ref      text not null,

  -- School context (denormalized so the prospect table is self-contained).
  school_id       integer,
  school_name     text,
  section_id      integer,
  section_name    text,

  -- The person.
  role            text,            -- 'Athletic Director' | 'Head Coach' | 'Principal' | ...
  sport           text,            -- null for faculty (AD, principal, trainer, ...)
  first_name      text,
  last_name       text,
  email           text,            -- normalized lowercase in the sync layer
  phone           text,
  ext             text,

  school_city     text,
  school_state    text,
  school_website  text,

  -- Set when a prospect is matched to / promoted into an existing customer.
  -- No FK for now (avoids coupling to customers.id typing); wired in a later phase.
  customer_id     uuid,

  -- 'active' | 'archived'. Staff can archive; re-sync will NOT resurrect an
  -- archived row (the sync payload omits status).
  status          text not null default 'active',

  first_seen_at   timestamptz not null default now(),
  last_synced_at  timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  unique (source, source_ref)
);

create index if not exists idx_marketing_contacts_section on public.marketing_contacts(section_id);
create index if not exists idx_marketing_contacts_sport   on public.marketing_contacts(sport);
create index if not exists idx_marketing_contacts_email    on public.marketing_contacts(lower(email));
create index if not exists idx_marketing_contacts_school  on public.marketing_contacts(school_id);
create index if not exists idx_marketing_contacts_status  on public.marketing_contacts(status);

alter table public.marketing_contacts enable row level security;

-- Staff-only, everything. Service-role sync bypasses RLS; the browser reads as the
-- authenticated staff user (is_team_member() → true) and may archive/annotate rows.
drop policy if exists marketing_contacts_staff_all on public.marketing_contacts;
create policy marketing_contacts_staff_all on public.marketing_contacts
  for all to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
