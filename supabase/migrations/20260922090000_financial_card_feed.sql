-- Service-only credit-card feed for the Financials expense workspace.
-- Provider credentials are encrypted by the Netlify function before storage.
create table public.financial_card_connections (
  id uuid primary key default gen_random_uuid(),
  company_key text not null check (company_key in ('national', 'methodic')),
  provider text not null default 'plaid' check (provider = 'plaid'),
  provider_item_id text not null unique,
  access_token_ciphertext text,
  institution_id text,
  institution_name text not null,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  sync_cursor text,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid not null references public.team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_key)
);

create table public.financial_card_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  company_key text not null check (company_key in ('national', 'methodic')),
  provider_account_id text not null unique,
  name text not null,
  official_name text,
  mask text,
  account_type text not null,
  account_subtype text,
  currency text not null default 'USD',
  current_balance_cents bigint,
  available_balance_cents bigint,
  qbo_payment_account_id text,
  qbo_payment_account_number text,
  qbo_payment_account_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_key),
  foreign key (connection_id, company_key) references public.financial_card_connections(id, company_key) on delete cascade
);

create table public.financial_expense_rules (
  id uuid primary key default gen_random_uuid(),
  company_key text not null check (company_key in ('national', 'methodic')),
  merchant_key text not null,
  merchant_label text not null,
  expense_account_id text not null,
  expense_account_number text,
  expense_account_name text not null,
  purpose text not null,
  created_by uuid not null references public.team_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_key, merchant_key)
);

alter table public.financial_expenses add constraint financial_expenses_id_company_unique unique (id, company_key);

create table public.financial_card_transactions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  account_id uuid not null,
  company_key text not null check (company_key in ('national', 'methodic')),
  provider_transaction_id text not null unique,
  pending_transaction_id text,
  transaction_date date not null,
  authorized_date date,
  merchant_name text,
  description text not null,
  amount_cents integer not null check (amount_cents <> 0),
  currency text not null default 'USD',
  pending boolean not null default false,
  provider_removed boolean not null default false,
  category_primary text,
  category_detailed text,
  status text not null default 'new' check (status in ('new', 'ready', 'submitted', 'posted', 'ignored', 'removed')),
  expense_account_id text,
  expense_account_number text,
  expense_account_name text,
  purpose text,
  receipt_required boolean not null default true,
  financial_expense_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_key),
  foreign key (connection_id, company_key) references public.financial_card_connections(id, company_key) on delete cascade,
  foreign key (account_id, company_key) references public.financial_card_accounts(id, company_key) on delete cascade,
  foreign key (financial_expense_id, company_key) references public.financial_expenses(id, company_key)
);

alter table public.financial_expenses
  add column card_transaction_id uuid,
  add constraint financial_expenses_card_transaction_company_fk foreign key (card_transaction_id, company_key)
    references public.financial_card_transactions(id, company_key);
create unique index financial_expenses_card_transaction_idx
  on public.financial_expenses(card_transaction_id)
  where card_transaction_id is not null and status <> 'cancelled';

create index financial_card_connections_company_idx on public.financial_card_connections(company_key, status);
create index financial_card_accounts_connection_idx on public.financial_card_accounts(connection_id, is_active);
create index financial_card_transactions_month_idx on public.financial_card_transactions(company_key, transaction_date desc, id);
create index financial_card_transactions_review_idx on public.financial_card_transactions(company_key, status, transaction_date desc);
create index financial_expense_rules_company_idx on public.financial_expense_rules(company_key, merchant_key);

alter table public.financial_card_connections enable row level security;
alter table public.financial_card_accounts enable row level security;
alter table public.financial_card_transactions enable row level security;
alter table public.financial_expense_rules enable row level security;
revoke all on public.financial_card_connections, public.financial_card_accounts, public.financial_card_transactions, public.financial_expense_rules from public, anon, authenticated;
grant select, insert, update, delete on public.financial_card_connections, public.financial_card_accounts, public.financial_card_transactions, public.financial_expense_rules to service_role;
