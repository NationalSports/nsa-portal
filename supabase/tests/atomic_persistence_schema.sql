-- Disposable database only. Aligned definitions from migration 00007; later ledger/version columns below.

create role anon; create role authenticated; create role service_role bypassrls;

create schema auth; create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role', true) $$;

create function public.is_team_member() returns boolean language sql as $$ select current_setting('test.staff',true) = 'true' $$;

CREATE TABLE public.team_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.customers (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES public.customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  alpha_tag TEXT,
  billing_address_line1 TEXT,
  billing_address_line2 TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  shipping_address_line1 TEXT,
  shipping_address_line2 TEXT,
  shipping_city TEXT,
  shipping_state TEXT,
  shipping_zip TEXT,
  adidas_ua_tier TEXT DEFAULT 'B',
  catalog_markup NUMERIC DEFAULT 1.65,
  payment_terms TEXT DEFAULT 'net30',
  tax_rate NUMERIC,
  tax_exempt BOOLEAN DEFAULT false,
  primary_rep_id TEXT REFERENCES public.team_members(id),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE public.customer_contacts (
  id SERIAL PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT,
  email TEXT,
  phone TEXT,
  role TEXT,
  sort_order INT DEFAULT 0
);

CREATE TABLE public.sales_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES public.customers(id),
  estimate_id TEXT ,
  memo TEXT,
  status TEXT DEFAULT 'need_order',
  created_by TEXT REFERENCES public.team_members(id),
  created_at TEXT,
  updated_at TEXT,
  expected_date TEXT,
  production_notes TEXT,
  shipping_type TEXT,
  shipping_value NUMERIC DEFAULT 0,
  ship_to_id TEXT DEFAULT 'default',
  default_markup NUMERIC DEFAULT 1.65,
  omg_store_id TEXT,
  _shipstation_order_id TEXT,
  _shipping_status TEXT,
  _tracking_number TEXT,
  _carrier TEXT,
  _ship_date TEXT,
  _tracking_url TEXT,
  _shipped BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ
);

CREATE TABLE public.so_firm_dates (
  id SERIAL PRIMARY KEY,
  so_id TEXT NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  item_desc TEXT,
  date TEXT,
  approved BOOLEAN DEFAULT false
);

CREATE TABLE public.invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES public.customers(id),
  so_id TEXT REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'invoice',
  date TEXT,
  due_date TEXT,
  total NUMERIC DEFAULT 0,
  paid NUMERIC DEFAULT 0,
  memo TEXT,
  status TEXT DEFAULT 'open',
  cc_fee NUMERIC DEFAULT 0,
  created_by TEXT REFERENCES public.team_members(id),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE public.invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT,
  qty INT,
  unit_price NUMERIC,
  total NUMERIC,
  description TEXT
);

CREATE TABLE public.invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC,
  method TEXT,
  ref TEXT,
  date TEXT
);

alter table customers add column _version integer not null default 1; alter table invoices add column _version integer not null default 1;
-- Later invoice fields used by the split transaction.
alter table invoices add column line_items jsonb, add column tax numeric default 0,
  add column shipping numeric default 0, add column credit_amount numeric default 0,
  add column deposit_applied numeric default 0, add column deposit_pct numeric default 0;

create function increment_version() returns trigger language plpgsql as $$ begin new._version := old._version+1; return new; end $$;

create trigger cust_version before update on customers for each row execute function increment_version(); create trigger inv_version before update on invoices for each row execute function increment_version();

-- ============================================================
-- invoice_payments: add the cc_fee column the client has always
-- written, and the unique key its upsert has always targeted.
--
-- WHY (2026-08-12, INV-1053). A rep reported an invoice paid on
-- 8/11 showing up on his JULY commission statement.
--
-- CommissionsPage puts a commission line in the month of the
-- invoice's LAST PAYMENT, and falls back to the invoice date
-- when an invoice carries no payment rows. INV-1053 (invoiced
-- 7/6, marked paid 8/11) carried none -- so it booked to July.
--
-- It carried none because writing one has never worked from the
-- client. _dbSaveInvoiceInner builds each payment row with a
-- `cc_fee` key, and this table has no cc_fee column; it also
-- upserts `onConflict: 'invoice_id,ref'`, and no unique index
-- covers those columns. So the upsert failed twice over, and the
-- old fallback path then DELETEd every payment row on the
-- invoice before re-inserting the very payload that had just
-- failed -- losing the write and any rows already there, with
-- both errors swallowed.
--
-- The audit log shows the damage precisely: of 30 lifetime
-- invoice_payments INSERTs, every single one was written by the
-- service role (the Stripe reconcile path in
-- netlify/functions/_shared.js, which does not send cc_fee).
-- Not one payment recorded by a human through the portal's
-- Receive Payment button has ever persisted -- 158 of 181 paid
-- invoices have no payment row at all -- and 8 DELETEs by real
-- users mark rows the fallback wiped.
--
-- This migration fixes the schema half. The client half (fail
-- closed instead of deleting on a failed write) ships with it in
-- src/lib/dbEngine.js.
-- ============================================================

-- 1. The column the client sends. Card surcharges are folded into
--    the payment amount; cc_fee tracks how much of it was fee, the
--    same meaning invoices.cc_fee has at the invoice level.
alter table public.invoice_payments
  add column if not exists cc_fee numeric not null default 0;

-- 2. The unique key the upsert targets. Verified free of
--    duplicates and of null refs before creating; the client
--    always coalesces a blank ref to 'pay_<n>' and the server
--    paths always set one, so no row can slip past on a null.
create unique index if not exists invoice_payments_invoice_ref_uniq
  on public.invoice_payments (invoice_id, ref);


grant usage on schema public, auth to anon, authenticated, service_role; grant all on all tables in schema public to authenticated, service_role; grant all on all sequences in schema public to authenticated, service_role;
