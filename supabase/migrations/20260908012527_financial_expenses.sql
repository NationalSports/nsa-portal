-- All access goes through financial-expenses, which verifies the existing
-- Financials owner allowlist. Clients cannot forge posting state or mappings.
create table public.financial_recurring_expenses (
  id uuid primary key,
  company_key text not null check (company_key in ('national', 'methodic')),
  label text not null,
  merchant text not null,
  default_amount_cents integer check (default_amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  purpose text not null,
  payment_kind text not null check (payment_kind in ('business', 'personal')),
  frequency text not null default 'monthly' check (frequency = 'monthly'),
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  requires_accounting_split boolean not null default false,
  created_by uuid not null references public.team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_recurring_expense_dates check (ends_on is null or ends_on >= starts_on)
);
create index financial_recurring_expenses_company_active_idx
  on public.financial_recurring_expenses(company_key, is_active, starts_on, id);
alter table public.financial_recurring_expenses enable row level security;
revoke all on public.financial_recurring_expenses from public, anon, authenticated;
grant select, insert, update on public.financial_recurring_expenses to service_role;

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
  expense_account_number text,
  expense_account_name text not null,
  payment_account_id text not null,
  payment_account_number text,
  payment_account_name text not null,
  vendor_id text,
  vendor_name text,
  receipt_path text,
  receipt_name text,
  recurring_template_id uuid references public.financial_recurring_expenses(id),
  recurring_month date,
  status text not null default 'submitted' check (status in ('submitted', 'posting', 'posted', 'error', 'cancelled')),
  qb_entity_type text not null check (qb_entity_type in ('Purchase', 'Bill')),
  qb_payload jsonb not null,
  qb_entity_id text,
  last_error text,
  posted_by uuid references public.team_members(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_expense_posted_identity check (status <> 'posted' or (qb_entity_id is not null and posted_at is not null)),
  constraint financial_expense_recurring_pair check (
    (recurring_template_id is null and recurring_month is null) or
    (recurring_template_id is not null and recurring_month is not null and extract(day from recurring_month) = 1)
  )
);
create index financial_expenses_company_created_idx on public.financial_expenses(company_key, created_at desc, id);
create index financial_expenses_submitter_idx on public.financial_expenses(submitted_by);
create index financial_expenses_poster_idx on public.financial_expenses(posted_by);
create unique index financial_expenses_qb_identity_idx on public.financial_expenses(realm_id, qb_entity_type, qb_entity_id) where qb_entity_id is not null;
create unique index financial_expenses_recurring_month_idx
  on public.financial_expenses(recurring_template_id, recurring_month)
  where recurring_template_id is not null and status <> 'cancelled';
alter table public.financial_expenses enable row level security;
revoke all on public.financial_expenses from public, anon, authenticated;
grant select, insert, update on public.financial_expenses to service_role;

-- Reviewable monthly schedules. They do not silently create accounting entries.
-- Vehicle loan payments require a principal/interest split before QBO posting.
insert into public.financial_recurring_expenses
  (id, company_key, label, merchant, default_amount_cents, purpose, payment_kind, starts_on, requires_accounting_split, created_by)
values
  ('74d77c6a-3d62-4c30-8e27-6dcfca8f1c51', 'national', 'Tesla loan payment', 'SchoolsFirst FCU', 112977,
    'Tesla loan payment; allocate principal and interest before posting to QuickBooks.', 'business', '2026-09-01', true, '00000000-0000-0000-0000-000000000001'),
  ('88a51d3c-d1aa-45a8-b841-2f0bd242d3d4', 'national', 'Rivian loan payment', 'SchoolsFirst FCU', 121199,
    'Rivian loan payment; allocate principal and interest before posting to QuickBooks.', 'business', '2026-09-01', true, '00000000-0000-0000-0000-000000000001'),
  ('a50f6e8d-1c53-4f88-9f91-dc7d3c4b74cb', 'national', 'T-Mobile service', 'T-Mobile', null,
    'Monthly T-Mobile mobile service.', 'business', '2026-09-01', false, '00000000-0000-0000-0000-000000000001');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 3145728, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;
-- Restrictive policies also constrain any pre-existing broad storage policies.
create policy expense_receipts_private on storage.objects as restrictive for all to anon, authenticated
using (bucket_id <> 'expense-receipts') with check (bucket_id <> 'expense-receipts');
