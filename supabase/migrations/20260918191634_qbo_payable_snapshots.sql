-- Diagnostic snapshots only; no accounting or automation-setting writes.
create table public.qbo_payable_snapshots (
  id uuid primary key,
  realm_id text not null check (realm_id ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  manifest jsonb not null,
  portal_snapshot jsonb not null
);
create table public.qbo_payable_snapshot_pages (
  snapshot_id uuid not null references public.qbo_payable_snapshots(id),
  entity text not null check (entity in ('Vendor','Item','Account','PurchaseOrder','Bill','VendorCredit','BillPayment')),
  page integer not null check (page >= 0),
  payload jsonb not null,
  primary key (snapshot_id,entity,page)
);
alter table public.qbo_payable_snapshots enable row level security;
alter table public.qbo_payable_snapshot_pages enable row level security;
revoke all on public.qbo_payable_snapshots, public.qbo_payable_snapshot_pages from public, anon, authenticated;
grant select, insert, update on public.qbo_payable_snapshots to service_role;
grant select, insert on public.qbo_payable_snapshot_pages to service_role;
alter table public.qbo_payable_review_runs add column snapshot_id uuid references public.qbo_payable_snapshots(id);
