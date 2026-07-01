-- Uniform Builder — saved custom uniform designs.
--
-- Persists designs created in the standalone /uniform-builder demo so they can be
-- reopened across devices (the client also keeps a localStorage copy as the
-- offline source of truth). A design is just the JSON design-spec that both the
-- SVG editor and the Canvas production renderer consume, plus a small PNG thumb.
--
-- The builder runs for logged-out coaches on the public demo route, so this table
-- allows anon insert/select. `owner` is nullable and stamped for authenticated
-- sessions so a later phase can scope "my designs" without a schema change.

create table if not exists public.uniform_designs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Custom Uniform',
  garment_id  text,
  spec        jsonb not null,
  thumb       text,                       -- data-URL PNG preview (front)
  owner       uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists uniform_designs_created_at_idx on public.uniform_designs (created_at desc);
create index if not exists uniform_designs_owner_idx on public.uniform_designs (owner);

alter table public.uniform_designs enable row level security;

-- Public demo: anyone (anon or authenticated) may create and read designs.
-- Tighten to `owner = auth.uid()` in a follow-up once the builder is behind login.
drop policy if exists uniform_designs_anon_insert on public.uniform_designs;
create policy uniform_designs_anon_insert
  on public.uniform_designs
  for insert
  to anon, authenticated
  with check (true);

drop policy if exists uniform_designs_anon_select on public.uniform_designs;
create policy uniform_designs_anon_select
  on public.uniform_designs
  for select
  to anon, authenticated
  using (true);
