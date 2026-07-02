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

-- The builder runs on a public route, so anyone may READ the library.
drop policy if exists uniform_patterns_public_select on public.uniform_patterns;
create policy uniform_patterns_public_select
  on public.uniform_patterns
  for select
  to anon, authenticated
  using (true);

-- Only signed-in portal staff may manage the library.
drop policy if exists uniform_patterns_auth_insert on public.uniform_patterns;
create policy uniform_patterns_auth_insert
  on public.uniform_patterns
  for insert
  to authenticated
  with check (true);

drop policy if exists uniform_patterns_auth_update on public.uniform_patterns;
create policy uniform_patterns_auth_update
  on public.uniform_patterns
  for update
  to authenticated
  using (true);

drop policy if exists uniform_patterns_auth_delete on public.uniform_patterns;
create policy uniform_patterns_auth_delete
  on public.uniform_patterns
  for delete
  to authenticated
  using (true);
