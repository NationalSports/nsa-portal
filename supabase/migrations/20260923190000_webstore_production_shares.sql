-- One revocable, store-scoped bearer link for each production handoff.
-- Only the server-side service role reads or writes the token hash.
create table if not exists public.webstore_production_shares (
  store_id uuid primary key references public.webstores(id) on delete cascade,
  token_hash text not null unique,
  token_encrypted text not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  revoked_at timestamptz
);

alter table public.webstore_production_shares enable row level security;
revoke all on public.webstore_production_shares from anon, authenticated;
grant all on public.webstore_production_shares to service_role;
