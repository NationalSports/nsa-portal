-- Manually-entered expected deliveries: "we ordered N of this size, landing on
-- DATE". Distinct from the vendor-feed future_delivery columns (a synced
-- snapshot of the VENDOR'S inbound stock) — this is NSA's own on-order record,
-- entered at purchase time. The roster ordering system merges these into its
-- availability math ("Short 5 → covered once +12 lands 8/18") and shows them on
-- hover in the size-totals matrix.
create table if not exists public.product_incoming (
  id            uuid primary key default gen_random_uuid(),
  product_id    text not null,
  size          text not null,
  qty           integer not null default 0,
  expected_date date,
  note          text,
  created_at    timestamptz default now()
);
create index if not exists idx_product_incoming_product on public.product_incoming (product_id);

alter table public.product_incoming enable row level security;
-- Same posture as the roster tables: the coach portal reads anonymously (the
-- portal link is the gate); staff manage rows signed-in.
drop policy if exists "product_incoming_anon" on public.product_incoming;
drop policy if exists "product_incoming_auth" on public.product_incoming;
create policy "product_incoming_anon" on public.product_incoming for select to anon using (true);
create policy "product_incoming_auth" on public.product_incoming for all to authenticated using (true) with check (true);
