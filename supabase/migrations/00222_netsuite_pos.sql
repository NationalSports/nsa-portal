-- netsuite_pos — the NetSuite purchase-order ignore list (refreshable).
--
-- Bills whose PO lives in NetSuite are NOT portal work: the order is brought in from
-- NetSuite and billed on that side (owner decision, 2026-07-19). This table replaces the
-- hardcoded src/netsuiteOldPos.js export as the source of truth so staff can refresh it
-- by re-running the NetSuite PO saved search and dropping the export on the Sports Inc
-- tab — no code deploy.
--
-- Seeding: the app bootstraps this table from the bundled netsuiteOldPos.js set (4,092
-- cores) the first time an active staff member opens the import page and finds it empty —
-- deliberate: the seed data ships in the bundle, so no 20KB of digits is hand-copied into
-- SQL where a transcription error would silently poison the ignore list.

create table if not exists public.netsuite_pos (
  core      text primary key,          -- numeric PO core ("6591"), digits only
  added_at  timestamptz not null default now(),
  added_by  text                        -- who refreshed the list (null = bundled seed)
);

alter table public.netsuite_pos enable row level security;

-- Same staff gate as si_documents: active team members read/write from the browser.
drop policy if exists netsuite_pos_staff_all on public.netsuite_pos;
create policy netsuite_pos_staff_all
  on public.netsuite_pos
  for all
  to authenticated
  using (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false))
  with check (exists (select 1 from public.team_members tm where tm.auth_id = auth.uid() and tm.is_active is not false));
