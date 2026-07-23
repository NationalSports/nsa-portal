-- Uniform Builder — saved custom uniform designs.
--
-- Persists designs created in the standalone /uniform-builder demo so they can be
-- reopened across devices (the client also keeps a localStorage copy as the
-- offline source of truth). A design is just the JSON design-spec that both the
-- SVG editor and the Canvas production renderer consume, plus a small PNG thumb.
--
-- The builder runs for logged-out coaches on the public route, but the table is
-- staff-only under RLS (00179 lockdown): the public builder saves through the
-- service-role uniform-builder-data function, which caps sizes server-side.
-- `owner` is nullable and stamped for authenticated sessions so a later phase
-- can scope "my designs" without a schema change.

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

-- Staff-only (matches the live 00179 posture). The public builder writes via
-- the service-role uniform-builder-data function, never with the anon key.
drop policy if exists uniform_designs_anon_insert on public.uniform_designs;
drop policy if exists uniform_designs_anon_select on public.uniform_designs;
drop policy if exists uniform_designs_staff_all on public.uniform_designs;
create policy uniform_designs_staff_all
  on public.uniform_designs
  for all
  to authenticated
  using (public.is_team_member())
  with check (public.is_team_member());
revoke select, insert, update, delete on public.uniform_designs from anon;
