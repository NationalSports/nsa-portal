-- Roster-based kit ordering system (replaces the Google Sheets workflow for large
-- accounts like Encinitas Express). Coaches build teams + rosters and fill per-player
-- sizes; staff load the item catalog (product/inventory links) and see live totals.
--
--   roster_kit_templates  – kit/item definitions. A row with is_catalog=true is the
--                           customer's master item menu (staff load products here);
--                           other rows are per-session snapshots.
--   roster_order_sessions – one per season / ordering event per customer
--   roster_teams          – one per age group / team within a session
--   roster_team_coaches   – which coach_accounts can edit each team
--   roster_players        – player rows within a team
--   roster_player_sizes   – per-player, per-slot size selection
--
-- NOTE: customer_id is TEXT (customer ids look like 'c-ns-3978'); coach access is
-- via the portal + coach_accounts, so RLS is intentionally permissive (anon for the
-- public portal read path, authenticated for signed-in coaches). Tighten later if
-- multi-tenant isolation is needed.

-- ─── 1. Kit templates / item catalog ──────────────────────────────────────────
create table if not exists public.roster_kit_templates (
  id              uuid primary key default gen_random_uuid(),
  customer_id     text,
  name            text not null,
  items           jsonb not null default '[]',
  is_catalog      boolean not null default false,
  created_at      timestamptz default now()
);
alter table public.roster_kit_templates enable row level security;
drop policy if exists "roster_kit_templates_anon" on public.roster_kit_templates;
drop policy if exists "roster_kit_templates_auth" on public.roster_kit_templates;
create policy "roster_kit_templates_anon" on public.roster_kit_templates for all to anon using (true) with check (true);
create policy "roster_kit_templates_auth" on public.roster_kit_templates for all to authenticated using (true) with check (true);

-- ─── 2. Order sessions ────────────────────────────────────────────────────────
create table if not exists public.roster_order_sessions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     text not null,
  kit_template_id uuid references public.roster_kit_templates(id) on delete set null,
  name            text not null,
  status          text not null default 'draft',
  season          text,
  deadline        date,
  notes           text,
  kit_items       jsonb not null default '[]',
  created_by      text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.roster_order_sessions enable row level security;
drop policy if exists "roster_sessions_anon" on public.roster_order_sessions;
drop policy if exists "roster_sessions_auth" on public.roster_order_sessions;
create policy "roster_sessions_anon" on public.roster_order_sessions for all to anon using (true) with check (true);
create policy "roster_sessions_auth" on public.roster_order_sessions for all to authenticated using (true) with check (true);

-- ─── 3. Teams ─────────────────────────────────────────────────────────────────
create table if not exists public.roster_teams (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.roster_order_sessions(id) on delete cascade,
  name            text not null,
  sort_order      int default 0,
  locked          boolean default false,
  created_at      timestamptz default now()
);
alter table public.roster_teams enable row level security;
drop policy if exists "roster_teams_anon" on public.roster_teams;
drop policy if exists "roster_teams_auth" on public.roster_teams;
create policy "roster_teams_anon" on public.roster_teams for all to anon using (true) with check (true);
create policy "roster_teams_auth" on public.roster_teams for all to authenticated using (true) with check (true);

-- ─── 4. Team ↔ Coach assignments ──────────────────────────────────────────────
create table if not exists public.roster_team_coaches (
  team_id         uuid not null references public.roster_teams(id) on delete cascade,
  coach_id        uuid not null references public.coach_accounts(id) on delete cascade,
  role            text not null default 'editor',
  assigned_at     timestamptz default now(),
  primary key (team_id, coach_id)
);
alter table public.roster_team_coaches enable row level security;
drop policy if exists "roster_tc_anon" on public.roster_team_coaches;
drop policy if exists "roster_tc_auth" on public.roster_team_coaches;
create policy "roster_tc_anon" on public.roster_team_coaches for all to anon using (true) with check (true);
create policy "roster_tc_auth" on public.roster_team_coaches for all to authenticated using (true) with check (true);

-- ─── 5. Players ───────────────────────────────────────────────────────────────
create table if not exists public.roster_players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.roster_teams(id) on delete cascade,
  first_name      text default '',
  last_name       text default '',
  jersey_number   text default '',
  is_gk           boolean default false,
  is_loaner       boolean default false,
  sort_order      int default 0,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.roster_players enable row level security;
drop policy if exists "roster_players_anon" on public.roster_players;
drop policy if exists "roster_players_auth" on public.roster_players;
create policy "roster_players_anon" on public.roster_players for all to anon using (true) with check (true);
create policy "roster_players_auth" on public.roster_players for all to authenticated using (true) with check (true);

-- ─── 6. Player size selections ────────────────────────────────────────────────
create table if not exists public.roster_player_sizes (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.roster_players(id) on delete cascade,
  kit_slot        text not null,
  size            text not null default '-',
  updated_at      timestamptz default now(),
  unique (player_id, kit_slot)
);
alter table public.roster_player_sizes enable row level security;
drop policy if exists "roster_psizes_anon" on public.roster_player_sizes;
drop policy if exists "roster_psizes_auth" on public.roster_player_sizes;
create policy "roster_psizes_anon" on public.roster_player_sizes for all to anon using (true) with check (true);
create policy "roster_psizes_auth" on public.roster_player_sizes for all to authenticated using (true) with check (true);
