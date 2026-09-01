-- Preserve the accounting adjustments already created by OrderEditor. These
-- values were previously client-only, so a reload could make QBO post a net
-- invoice entirely to 40000 Sales instead of routing the customer credit to
-- 40200 Discounts. `deposit_applied` is also retained so prior deposit usage
-- remains auditable and distinguishable from a discount.
alter table public.invoices
  add column if not exists credit_amount numeric(12,2) not null default 0,
  add column if not exists deposit_applied numeric(12,2) not null default 0;

alter table public.invoices
  drop constraint if exists invoices_credit_amount_nonnegative,
  add constraint invoices_credit_amount_nonnegative check (credit_amount >= 0) not valid,
  drop constraint if exists invoices_deposit_applied_nonnegative,
  add constraint invoices_deposit_applied_nonnegative check (deposit_applied >= 0) not valid;

alter table public.invoices validate constraint invoices_credit_amount_nonnegative;
alter table public.invoices validate constraint invoices_deposit_applied_nonnegative;
