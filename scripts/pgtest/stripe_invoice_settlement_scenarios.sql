-- Standalone transactional fixture for the atomic Stripe invoice settlement migration.
-- Run in a disposable PostgreSQL database, then apply the migration before this file's scenarios.

create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.role() returns text language sql stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

create table public.invoices (
  id text primary key,
  total numeric not null default 0,
  paid numeric not null default 0,
  cc_fee numeric not null default 0,
  status text not null default 'open',
  updated_at timestamptz
);
create table public.invoice_payments (
  id bigint generated always as identity primary key,
  invoice_id text not null references public.invoices(id) on delete cascade,
  amount numeric,
  method text,
  ref text,
  date text,
  cc_fee numeric not null default 0
);
create unique index invoice_payments_invoice_ref_uniq
  on public.invoice_payments(invoice_id, ref);

-- The runner applies 20260904224514_atomic_stripe_invoice_settlement.sql here.

select set_config('request.jwt.claim.role', 'service_role', false);

insert into public.invoices(id, total, paid, cc_fee, status) values
  ('INV-A', 100, 0, 0, 'open'),
  ('INV-B', 100, 0, 0, 'open');

select public.settle_stripe_invoice_payment(
  'pi_fresh', array['INV-B', 'INV-A'], 20600, 'cc', '09/04/2026'
);

do $$
declare
  v_paid numeric;
  v_total numeric;
  v_fee numeric;
  v_ledger numeric;
  v_alloc bigint;
begin
  select sum(paid), sum(total), sum(cc_fee)
    into v_paid, v_total, v_fee from public.invoices where id in ('INV-A', 'INV-B');
  select sum(amount), count(*) into v_ledger, v_alloc
    from public.invoice_payments where ref = 'Stripe pi_fresh';
  if v_paid <> 206 or v_total <> 206 or v_fee <> 6
      or v_ledger <> 206 or v_alloc <> 2 then
    raise exception 'fresh settlement did not balance: paid %, total %, fee %, ledger %, rows %',
      v_paid, v_total, v_fee, v_ledger, v_alloc;
  end if;
  if (select sum(amount_cents) from public.stripe_invoice_payment_allocations
       where payment_intent_id = 'pi_fresh') <> 20600 then
    raise exception 'allocation cents do not equal captured cents';
  end if;
end $$;

-- Exact retry: no new money, fee, or ledger rows.
select public.settle_stripe_invoice_payment(
  'pi_fresh', array['INV-A', 'INV-B'], 20600, 'cc', '09/05/2026'
);
do $$
begin
  if (select sum(paid) from public.invoices where id in ('INV-A', 'INV-B')) <> 206
      or (select count(*) from public.invoice_payments where ref = 'Stripe pi_fresh') <> 2
      or (select count(*) from public.stripe_invoice_payment_allocations
           where payment_intent_id = 'pi_fresh') <> 2 then
    raise exception 'idempotent retry changed persisted settlement';
  end if;
  if exists (select 1 from public.invoice_payments
              where ref = 'Stripe pi_fresh' and date <> '09/04/2026') then
    raise exception 'retry replaced the original payment date';
  end if;
end $$;

-- A later missing ledger mirror is independently detectable because the original split survives
-- in stripe_invoice_payment_allocations. A retry restores the exact row without moving money again.
delete from public.invoice_payments
 where invoice_id = 'INV-A' and ref = 'Stripe pi_fresh';
select public.settle_stripe_invoice_payment(
  'pi_fresh', array['INV-A', 'INV-B'], 20600, 'cc', '09/06/2026'
);
do $$
begin
  if (select count(*) from public.invoice_payments where ref = 'Stripe pi_fresh') <> 2
      or (select sum(amount) from public.invoice_payments where ref = 'Stripe pi_fresh') <> 206
      or exists (select 1 from public.invoice_payments
                  where ref = 'Stripe pi_fresh' and date <> '09/04/2026') then
    raise exception 'retry did not restore the exact durable ledger allocation';
  end if;
end $$;

set role authenticated;
do $$
begin
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_unauthorized', array['INV-B'], 100, 'cc', '09/04/2026'
    );
    raise exception 'authenticated role unexpectedly executed settlement RPC';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

-- Server-side amount/method validation runs under the same invoice locks.
insert into public.invoices(id, total, paid, cc_fee, status) values
  ('INV-UNDER', 100, 0, 0, 'open'),
  ('INV-OVER', 100, 0, 0, 'open'),
  ('INV-ACH-FEE', 100, 0, 0, 'open');
do $$
begin
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_under', array['INV-UNDER'], 9999, 'cc', '09/04/2026'
    );
    raise exception 'expected underpayment rejection';
  exception when check_violation then
    if sqlerrm not like 'Stripe collection is less%' then raise; end if;
  end;
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_over', array['INV-OVER'], 10700, 'cc', '09/04/2026'
    );
    raise exception 'expected excessive surcharge rejection';
  exception when check_violation then
    if sqlerrm not like 'Stripe collection exceeds%' then raise; end if;
  end;
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_ach_fee', array['INV-ACH-FEE'], 10100, 'ach', '09/04/2026'
    );
    raise exception 'expected ACH surcharge rejection';
  exception when check_violation then
    if sqlerrm not like 'ACH invoice collection cannot%' then raise; end if;
  end;
  if exists (select 1 from public.invoices
              where id in ('INV-UNDER', 'INV-OVER', 'INV-ACH-FEE') and paid <> 0) then
    raise exception 'rejected settlement changed an invoice';
  end if;
end $$;

-- Simulate a ledger failure on the second invoice. The first invoice update/insert and every
-- allocation row must roll back with it.
insert into public.invoices(id, total, paid, cc_fee, status) values
  ('INV-C', 50, 0, 0, 'open'),
  ('INV-D', 50, 0, 0, 'open');
create function public.reject_inv_d_payment() returns trigger language plpgsql as $$
begin
  if new.invoice_id = 'INV-D' then raise exception 'synthetic ledger failure'; end if;
  return new;
end $$;
create trigger reject_inv_d_payment before insert on public.invoice_payments
  for each row execute function public.reject_inv_d_payment();

do $$
begin
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_rollback', array['INV-C', 'INV-D'], 10300, 'cc', '09/04/2026'
    );
    raise exception 'expected synthetic ledger failure';
  exception when others then
    if sqlerrm = 'expected synthetic ledger failure' then raise; end if;
  end;
  if exists (select 1 from public.invoices
              where id in ('INV-C', 'INV-D') and (paid <> 0 or total <> 50 or cc_fee <> 0))
      or exists (select 1 from public.invoice_payments where ref = 'Stripe pi_rollback')
      or exists (select 1 from public.stripe_invoice_payment_allocations
                  where payment_intent_id = 'pi_rollback') then
    raise exception 'failed settlement did not roll back every write';
  end if;
end $$;
drop trigger reject_inv_d_payment on public.invoice_payments;
drop function public.reject_inv_d_payment();

-- Legacy partial reproduction: one invoice already shows $103 paid but no durable allocation.
-- Retrying the original $206 collection must make no changes (never $309 / $109 fees).
insert into public.invoices(id, total, paid, cc_fee, status) values
  ('INV-LEGACY-A', 103, 103, 3, 'paid'),
  ('INV-LEGACY-B', 100, 0, 0, 'open');
do $$
begin
  begin
    perform public.settle_stripe_invoice_payment(
      'pi_legacy', array['INV-LEGACY-A', 'INV-LEGACY-B'], 20600, 'cc', '09/04/2026'
    );
    raise exception 'expected legacy partial rejection';
  exception when check_violation then
    if sqlerrm not like 'legacy partial Stripe application%' then raise; end if;
  end;
  if (select sum(paid) from public.invoices
       where id in ('INV-LEGACY-A', 'INV-LEGACY-B')) <> 103
      or (select sum(cc_fee) from public.invoices
           where id in ('INV-LEGACY-A', 'INV-LEGACY-B')) <> 3
      or exists (select 1 from public.invoice_payments where ref = 'Stripe pi_legacy') then
    raise exception 'legacy partial retry duplicated captured money';
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon',
       'public.settle_stripe_invoice_payment(text,text[],bigint,text,text)', 'EXECUTE')
      or has_function_privilege('authenticated',
       'public.settle_stripe_invoice_payment(text,text[],bigint,text,text)', 'EXECUTE')
      or not has_function_privilege('service_role',
       'public.settle_stripe_invoice_payment(text,text[],bigint,text,text)', 'EXECUTE') then
    raise exception 'settlement RPC grants are not service-only';
  end if;
  if has_table_privilege('anon', 'public.stripe_invoice_payment_allocations', 'SELECT')
      or has_table_privilege('authenticated', 'public.stripe_invoice_payment_allocations', 'SELECT')
      or not has_table_privilege('service_role', 'public.stripe_invoice_payment_allocations', 'SELECT') then
    raise exception 'allocation table grants are not service-only';
  end if;
end $$;
