-- Methodic <-> National intercompany accounting.
--
-- Methodic owns the customer invoice in its QBO company. National owns the
-- matching vendor bill in its QBO company. Payments are recorded as a paired
-- National BillPayment + Methodic Payment, with local rows preserving partial
-- success so retries never blindly duplicate a transaction.

alter table public.qb_oauth_tokens
  add column if not exists company_key text;

update public.qb_oauth_tokens
   set company_key = 'national'
 where company_key is null;

-- The old connector was single-company but could leave an obsolete realm row
-- behind after a reconnect. Keep only the newest legacy National connection
-- before enforcing one token row per named company.
with ranked as (
  select realm_id,
         row_number() over (partition by company_key order by updated_at desc, realm_id desc) as row_rank
    from public.qb_oauth_tokens
)
delete from public.qb_oauth_tokens t
 using ranked r
 where t.realm_id = r.realm_id
   and r.row_rank > 1;

alter table public.qb_oauth_tokens
  alter column company_key set default 'national',
  alter column company_key set not null;

alter table public.qb_oauth_tokens
  drop constraint if exists qb_oauth_tokens_company_key_check;
alter table public.qb_oauth_tokens
  add constraint qb_oauth_tokens_company_key_check
  check (company_key in ('national', 'methodic'));

create unique index if not exists qb_oauth_tokens_company_key_uidx
  on public.qb_oauth_tokens (company_key);

alter table public.methodic_requests
  drop constraint if exists methodic_requests_billing_status_check;

alter table public.methodic_requests
  add column if not exists billing_amount_cents integer,
  add column if not exists billing_invoice_date date,
  add column if not exists billing_due_date date,
  add column if not exists billing_synced_at timestamptz,
  add column if not exists billing_last_attempt_at timestamptz,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists amount_paid_cents integer not null default 0,
  add column if not exists methodic_qb_payment_id text,
  add column if not exists national_qb_bill_payment_id text,
  add column if not exists paid_at timestamptz;

alter table public.methodic_requests
  add constraint methodic_requests_billing_status_check check (billing_status in (
    'not_ready','ready','queued','syncing','partial','posted','verified','open','paid','error','void'
  )),
  add constraint methodic_requests_payment_status_check check (payment_status in (
    'unpaid','partial','paid','void'
  )),
  add constraint methodic_requests_billing_amount_nonnegative check (
    billing_amount_cents is null or billing_amount_cents >= 0
  ),
  add constraint methodic_requests_amount_paid_nonnegative check (amount_paid_cents >= 0),
  add constraint methodic_requests_paid_not_over_billed check (
    billing_amount_cents is null or amount_paid_cents <= billing_amount_cents
  );

create table if not exists public.methodic_accounting_config (
  id text primary key default 'default' check (id = 'default'),
  national_vendor_qb_id text,
  national_expense_account_qb_id text,
  national_payment_account_qb_id text,
  methodic_customer_qb_id text,
  methodic_income_item_qb_id text,
  methodic_deposit_account_qb_id text,
  methodic_tax_code_qb_id text,
  national_sandbox boolean not null default false,
  methodic_sandbox boolean not null default false,
  invoice_sync_enabled boolean not null default false,
  payment_sync_enabled boolean not null default false,
  updated_by text references public.team_members(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.methodic_accounting_config (id)
values ('default')
on conflict (id) do nothing;

create sequence if not exists public.methodic_payment_number_seq start with 1001;

create table if not exists public.methodic_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text not null unique default
    ('MTP-' || lpad(nextval('public.methodic_payment_number_seq')::text, 5, '0')),
  request_id uuid not null references public.methodic_requests(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  payment_date date not null,
  reference_number text,
  memo text,
  status text not null default 'queued' check (status in (
    'queued','syncing','partial','posted','verified','error','void'
  )),
  national_qb_bill_payment_id text,
  methodic_qb_payment_id text,
  sync_error text,
  created_by text references public.team_members(id) on delete set null,
  updated_by text references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists methodic_requests_billing_queue_idx
  on public.methodic_requests (billing_status, billing_due_date);
create index if not exists methodic_payments_request_idx
  on public.methodic_payments (request_id, created_at desc);

create or replace function public.reserve_methodic_payment(
  p_request_id uuid,
  p_amount_cents integer,
  p_payment_date date,
  p_reference_number text,
  p_memo text,
  p_actor_id text
)
returns public.methodic_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.methodic_requests;
  v_reserved bigint;
  v_payment public.methodic_payments;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select * into v_request
    from public.methodic_requests
   where id = p_request_id
   for update;
  if not found then raise exception 'Methodic request not found.'; end if;
  if v_request.billing_amount_cents is null or v_request.billing_amount_cents <= 0 then
    raise exception 'Prepare the Methodic invoice before recording payment.';
  end if;

  select coalesce(sum(amount_cents), 0) into v_reserved
    from public.methodic_payments
   where request_id = p_request_id
     and status <> 'void';
  if v_reserved + p_amount_cents > v_request.billing_amount_cents then
    raise exception 'Payment exceeds the remaining Methodic invoice balance.';
  end if;

  insert into public.methodic_payments (
    request_id, amount_cents, payment_date, reference_number, memo,
    created_by, updated_by
  ) values (
    p_request_id, p_amount_cents, p_payment_date,
    nullif(trim(p_reference_number), ''), nullif(trim(p_memo), ''),
    p_actor_id, p_actor_id
  ) returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function public.reserve_methodic_payment(uuid, integer, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_methodic_payment(uuid, integer, date, text, text, text)
  to service_role;

drop trigger if exists methodic_accounting_config_updated_at on public.methodic_accounting_config;
create trigger methodic_accounting_config_updated_at
before update on public.methodic_accounting_config
for each row execute function public.set_methodic_request_updated_at();

drop trigger if exists methodic_payment_updated_at on public.methodic_payments;
create trigger methodic_payment_updated_at
before update on public.methodic_payments
for each row execute function public.set_methodic_request_updated_at();

alter table public.methodic_accounting_config enable row level security;
alter table public.methodic_payments enable row level security;

drop policy if exists methodic_accounting_config_staff_read on public.methodic_accounting_config;
create policy methodic_accounting_config_staff_read on public.methodic_accounting_config
for select to authenticated
using ((select public.is_team_member()));

drop policy if exists methodic_payments_staff_read on public.methodic_payments;
create policy methodic_payments_staff_read on public.methodic_payments
for select to authenticated
using ((select public.is_team_member()));

revoke all on public.methodic_accounting_config from anon, authenticated;
revoke all on public.methodic_payments from anon, authenticated;
grant select on public.methodic_accounting_config to authenticated;
grant select on public.methodic_payments to authenticated;
grant all on public.methodic_accounting_config to service_role;
grant all on public.methodic_payments to service_role;
grant usage, select on sequence public.methodic_payment_number_seq to service_role;
