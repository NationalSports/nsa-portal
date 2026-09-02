-- A UI guard closes the ordinary double-click window, while this durable key is
-- the final backstop for overlapping tabs/sessions. Manual and split invoices
-- keep this NULL, so legitimate multi-invoice SO workflows remain unchanged.
alter table public.invoices
  add column if not exists idempotency_key text;

create unique index if not exists invoices_idempotency_key_uidx
  on public.invoices (idempotency_key)
  where idempotency_key is not null;
