-- Received payments (checks, ACH, etc.) as their own record — the Receive Payments page.
--
-- Until now a check only existed as the per-invoice pieces it paid (invoice_payments rows),
-- so one check split across three invoices was three unrelated rows, and money a customer
-- overpaid had nowhere to live. A payment_receipts row is the check itself; each portal
-- invoice it pays is still an ordinary invoice_payments row (so commissions, invoice status
-- and the hourly QBO payment sync keep working untouched) that now points back here via
-- receipt_id.
--
-- NetSuite-imported invoices (customer_invoices) have no invoice_payments rows — paying one
-- only lowers its open_balance — so their share of a check is recorded in ns_applications.
--
-- Unapplied (left on the customer's account) = amount − portal rows − ns_applications.
-- Nothing stores it, so it can never drift from the applications themselves.

create table if not exists public.payment_receipts (
  id text primary key,
  customer_id text not null,
  amount numeric not null check (amount > 0),
  method text not null default 'check',
  ref text,                          -- check #, ACH trace, etc.
  received_date text not null,       -- MM/DD/YYYY, same format as invoice_payments.date
  memo text,
  ns_applications jsonb not null default '[]'::jsonb, -- [{invoice_id, netsuite_internal_id, amount, date, by}]
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_receipts_customer_idx on public.payment_receipts (customer_id);
create index if not exists payment_receipts_created_idx on public.payment_receipts (created_at desc);

alter table public.payment_receipts enable row level security;
-- Staff only (no anon read — unlike invoice_payments, nothing public needs these).
drop policy if exists payment_receipts_staff_all on public.payment_receipts;
create policy payment_receipts_staff_all on public.payment_receipts
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
grant select, insert, update, delete on public.payment_receipts to authenticated;
grant all on public.payment_receipts to service_role;

alter table public.invoice_payments add column if not exists receipt_id text;
create index if not exists invoice_payments_receipt_idx on public.invoice_payments (receipt_id) where receipt_id is not null;
