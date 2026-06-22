-- Roster-based kit ordering system (replaces Google Sheets workflow for large accounts
-- like Encinitas Express). Coaches fill in per-player sizes per team; staff see live
-- totals vs. inventory and can generate a sales order.
--
--   roster_kit_templates  – reusable kit definition (items array with slot, label, flags)
--   roster_order_sessions – one per season / ordering event per customer
--   roster_teams          – one per age group / team within a session
--   roster_team_coaches   – which coach_accounts can edit each team
--   roster_players        – player rows within a team
--   roster_player_sizes   – per-player, per-slot size selection

-- ─── 1. Kit templates ─────────────────────────────────────────────────────────
create table if not exists public.roster_kit_templates (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  name            text not null,
  items           jsonb not null default '[]',
  created_at      timestamptz not null default now()
);
alter table public.roster_kit_templates enable row level security;

create policy "roster_kit_templates_read" on public.roster_kit_templates
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_kit_templates_write" on public.roster_kit_templates
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
  );

-- ─── 2. Order sessions ────────────────────────────────────────────────────────
create table if not exists public.roster_order_sessions (
  id              uuid primary key default gen_random_uuid(),
  customer_id     uuid not null references public.customers(id) on delete cascade,
  kit_template_id uuid references public.roster_kit_templates(id) on delete set null,
  name            text not null,
  season          text,
  deadline        date,
  notes           text,
  status          text not null default 'open'
                    check (status in ('draft','open','submitted','processing','fulfilled')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.roster_order_sessions enable row level security;

create policy "roster_order_sessions_read" on public.roster_order_sessions
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_order_sessions_write" on public.roster_order_sessions
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
  );

-- ─── 3. Teams ─────────────────────────────────────────────────────────────────
create table if not exists public.roster_teams (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.roster_order_sessions(id) on delete cascade,
  name            text not null,
  sort_order      int not null default 0,
  locked          boolean not null default false,
  created_at      timestamptz not null default now()
);
alter table public.roster_teams enable row level security;

create policy "roster_teams_read" on public.roster_teams
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_teams_write" on public.roster_teams
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

-- ─── 4. Team ↔ Coach assignments ──────────────────────────────────────────────
create table if not exists public.roster_team_coaches (
  team_id         uuid not null references public.roster_teams(id) on delete cascade,
  coach_id        uuid not null references public.coach_accounts(id) on delete cascade,
  role            text not null default 'editor'
                    check (role in ('editor','viewer')),
  assigned_at     timestamptz not null default now(),
  primary key (team_id, coach_id)
);
alter table public.roster_team_coaches enable row level security;

create policy "roster_team_coaches_read" on public.roster_team_coaches
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_team_coaches_write" on public.roster_team_coaches
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

-- ─── 5. Players ───────────────────────────────────────────────────────────────
create table if not exists public.roster_players (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.roster_teams(id) on delete cascade,
  first_name      text not null default '',
  last_name       text not null default '',
  jersey_number   text not null default '',
  is_gk           boolean not null default false,
  is_loaner       boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
alter table public.roster_players enable row level security;

create policy "roster_players_read" on public.roster_players
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_players_write" on public.roster_players
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

-- ─── 6. Player size selections ────────────────────────────────────────────────
create table if not exists public.roster_player_sizes (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references public.roster_players(id) on delete cascade,
  kit_slot        text not null,
  size            text not null default '-',
  updated_at      timestamptz not null default now(),
  unique (player_id, kit_slot)
);
alter table public.roster_player_sizes enable row level security;

create policy "roster_player_sizes_read" on public.roster_player_sizes
  for select using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );

create policy "roster_player_sizes_write" on public.roster_player_sizes
  for all using (
    public.is_admin_or_gm()
    or public.current_user_role() in ('rep','csr','accounting')
    or auth.role() = 'authenticated'
  );
