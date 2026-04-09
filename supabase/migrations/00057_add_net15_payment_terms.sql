-- Add 'net15' to the allowed payment_terms values on the customers table.
-- The UI already offers Net 15 as an option but the check constraint was missing it,
-- causing inserts/updates to fail with a constraint-violation error.

alter table public.customers
  drop constraint if exists customers_payment_terms_check;

alter table public.customers
  add constraint customers_payment_terms_check
  check (payment_terms in ('net15','net30','net60','prepay'));
