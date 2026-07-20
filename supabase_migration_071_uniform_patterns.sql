-- Uniform Builder — admin-curated pattern library.
--
-- Staff upload seamless pattern tiles (Settings → Uniform Patterns in the
-- portal); every coach's builder lists them alongside the built-in patterns.
-- Tiles are stored inline as data-URL PNGs (uploads are downscaled client-side
-- to <=512px, so rows stay small) — no storage bucket needed.

create table if not exists public.uniform_patterns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image       text not null,              -- data-URL PNG tile (seamless)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists uniform_patterns_active_idx on public.uniform_patterns (active, created_at desc);

alter table public.uniform_patterns enable row level security;

-- Staff-only (matches the live 00179 posture). The public builder lists active
-- patterns through the service-role uniform-builder-data function.
drop policy if exists uniform_patterns_public_select on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_insert on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_update on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_delete on public.uniform_patterns;
drop policy if exists uniform_patterns_staff_all on public.uniform_patterns;
create policy uniform_patterns_staff_all
  on public.uniform_patterns
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
revoke select, insert, update, delete on public.uniform_patterns from anon;
