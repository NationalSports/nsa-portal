-- Team Shop / Club auto-release settings (automation trio #2 — the gate).
--
-- Trio #2 is a scheduled sweep (netlify/functions/teamshop-auto-release.js) that
-- finds so_jobs sitting on prod_status='hold' whose readiness it can PROVE by a
-- server-side recompute (art done AND garments in hand) and releases them through
-- advance_job_stage('release', …) — the SAME 00205 gate a staff scan goes through,
-- never a direct prod_status write. This migration adds only the on/off switch and
-- the scope selector it reads.
--
-- DEFAULT-OFF, unlike auto-art (trio #1, safe-by-construction). Auto-release moves
-- jobs into the live production queue with no human in the loop, so it stays dark
-- until the owner flips it on. Two knobs:
--   * auto_release_enabled (default FALSE) — master switch.
--   * auto_release_scope   (default 'auto_art_only'):
--       'auto_art_only' — release ONLY jobs BORN art_complete by trio #1's auto-art
--                         (identified by their 'created' job_stage_event's
--                         to_state.art_status='art_complete' + payload.auto_art).
--                         The conservative first lane: these jobs' art was already
--                         human-finished, so releasing them once stock lands removes
--                         the last manual touch for the fully-automated happy path.
--       'all'           — release ANY hold job the server recompute proves ready,
--                         including ones a person finished art on later.
--
-- Singleton table (id fixed to 'global'): the trio is a single owner-level policy,
-- not per-store/per-vendor, so one row is the whole config. teamshop_auto_po_settings
-- (00202) is PER-VENDOR by nature (routing + submit per supplier); this is not, so a
-- separate one-row surface is the honest shape rather than overloading that table.
--
-- Staff read + staff update (a manager can flip the switch without an engineering
-- ticket) — same RLS posture as teamshop_auto_po_settings. No delete (there is one
-- fixed row). The sweep itself runs as service_role and bypasses RLS.

create table if not exists public.teamshop_settings (
  id                   text primary key default 'global',
  auto_release_enabled boolean not null default false,
  auto_release_scope   text    not null default 'auto_art_only',
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  constraint teamshop_settings_singleton check (id = 'global'),
  constraint teamshop_settings_scope     check (auto_release_scope in ('auto_art_only', 'all'))
);

-- Seed the single row, default-off. Replay-safe.
insert into public.teamshop_settings (id) values ('global')
on conflict (id) do nothing;

alter table public.teamshop_settings enable row level security;
drop policy if exists teamshop_settings_staff_read on public.teamshop_settings;
create policy teamshop_settings_staff_read on public.teamshop_settings
  for select to authenticated using (public.is_team_member());
drop policy if exists teamshop_settings_staff_insert on public.teamshop_settings;
create policy teamshop_settings_staff_insert on public.teamshop_settings
  for insert to authenticated with check (public.is_team_member());
drop policy if exists teamshop_settings_staff_update on public.teamshop_settings;
create policy teamshop_settings_staff_update on public.teamshop_settings
  for update to authenticated using (public.is_team_member()) with check (public.is_team_member());
revoke select, insert, update, delete on public.teamshop_settings from anon;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop table if exists public.teamshop_settings;
