-- All access goes through financial-expenses, which verifies the existing
-- Financials owner allowlist. Clients cannot forge posting state or mappings.
create table public.financial_expenses (
  id uuid primary key,
  company_key text not null check (company_key in ('national', 'methodic')),
  realm_id text not null,
  submitted_by uuid not null references public.team_members(id),
  merchant text not null,
  expense_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  purpose text not null,
  payment_kind text not null check (payment_kind in ('business', 'personal')),
  expense_account_id text not null,
  expense_account_name text not null,
  payment_account_id text not null,
  payment_account_name text not null,
  vendor_id text,
  vendor_name text,
  receipt_path text,
  receipt_name text,
  status text not null default 'submitted' check (status in ('submitted', 'posting', 'posted', 'error', 'cancelled')),
  qb_entity_type text not null check (qb_entity_type in ('Purchase', 'Bill')),
  qb_payload jsonb not null,
  qb_entity_id text,
  last_error text,
  posted_by uuid references public.team_members(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_expense_posted_identity check (status <> 'posted' or (qb_entity_id is not null and posted_at is not null))
);
create index financial_expenses_company_created_idx on public.financial_expenses(company_key, created_at desc, id);
create index financial_expenses_submitter_idx on public.financial_expenses(submitted_by);
create index financial_expenses_poster_idx on public.financial_expenses(posted_by);
create unique index financial_expenses_qb_identity_idx on public.financial_expenses(realm_id, qb_entity_type, qb_entity_id) where qb_entity_id is not null;
alter table public.financial_expenses enable row level security;
revoke all on public.financial_expenses from public, anon, authenticated;
grant select, insert, update on public.financial_expenses to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 3145728, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;
-- Restrictive policies also constrain any pre-existing broad storage policies.
create policy expense_receipts_private on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'expense-receipts') with check (bucket_id <> 'expense-receipts');
