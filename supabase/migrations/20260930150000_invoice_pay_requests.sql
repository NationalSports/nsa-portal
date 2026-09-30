-- Partial pay links: accounting asks a customer to pay PART of an invoice online
-- (e.g. $2,000 of a $5,000 invoice) and sends a link for exactly that amount.
--
-- The online-payment reconciliation (reconcileInvoiceFromIntent in netlify/functions/_shared.js)
-- deliberately refuses to settle an invoice for less than its open balance — otherwise any tiny
-- payment could mark a large invoice paid. A partial payment is only legitimate when staff asked
-- for it, so the request itself is the server-side authority: the Stripe intent carries its id,
-- the server charges the requested amount (plus the card fee when paying by card) and applies
-- exactly that amount to the invoice.
--
-- id is a random, unguessable token that goes in the link. Staff create/cancel requests from the
-- invoice page; the anonymous portal never reads this table directly (the stripe-payment function
-- looks a request up by token with the service role and returns only what the payer needs).

create table if not exists public.invoice_pay_requests (
  id text primary key check (length(id) >= 24),
  invoice_id text not null references public.invoices(id) on delete cascade,
  amount numeric not null check (amount >= 0.5),
  status text not null default 'open' check (status in ('open','paid','cancelled')),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  payment_intent_id text,
  cancelled_at timestamptz
);
create index if not exists invoice_pay_requests_invoice_idx on public.invoice_pay_requests (invoice_id);

alter table public.invoice_pay_requests enable row level security;
drop policy if exists invoice_pay_requests_staff_all on public.invoice_pay_requests;
create policy invoice_pay_requests_staff_all on public.invoice_pay_requests
  for all to authenticated using (public.is_team_member()) with check (public.is_team_member());
revoke all on public.invoice_pay_requests from anon;
grant select, insert, update on public.invoice_pay_requests to authenticated;
grant all on public.invoice_pay_requests to service_role;
