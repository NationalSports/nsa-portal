-- Persist the tax decision made at checkout and ingest Stripe's settlement
-- ledger.  The two Stripe tables are intentionally service-role-only: they
-- contain company-wide payout/accounting data and are never read directly by
-- the browser.

alter table public.webstore_orders
  add column if not exists tax_state text,
  add column if not exists tax_rate numeric(9, 6),
  add column if not exists tax_source text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_balance_transaction_id text,
  add column if not exists stripe_fee_cents bigint,
  add column if not exists stripe_net_cents bigint;

comment on column public.webstore_orders.tax_state is
  'Immutable two-letter destination state used for the checkout tax decision, including pickup/team-delivery billing jurisdictions.';
comment on column public.webstore_orders.tax_rate is
  'Immutable decimal tax rate returned by CDTFA/TaxCloud at checkout (for example 0.077500).';
comment on column public.webstore_orders.tax_source is
  'Immutable checkout tax decision source (CDTFA, TaxCloud, not_registered, or zero_base).';
comment on column public.webstore_orders.stripe_fee_cents is
  'Actual Stripe fee from the charge balance transaction; customer-facing processing_fee is separate revenue.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'webstore_orders_tax_state_format'
      and conrelid = 'public.webstore_orders'::regclass
  ) then
    alter table public.webstore_orders
      add constraint webstore_orders_tax_state_format
      check (tax_state is null or tax_state ~ '^[A-Z]{2}$') not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'webstore_orders_tax_rate_range'
      and conrelid = 'public.webstore_orders'::regclass
  ) then
    alter table public.webstore_orders
      add constraint webstore_orders_tax_rate_range
      check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 1)) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'webstore_orders_stripe_fee_nonnegative'
      and conrelid = 'public.webstore_orders'::regclass
  ) then
    alter table public.webstore_orders
      add constraint webstore_orders_stripe_fee_nonnegative
      check (stripe_fee_cents is null or stripe_fee_cents >= 0) not valid;
  end if;
end $$;

alter table public.webstore_orders validate constraint webstore_orders_tax_state_format;
alter table public.webstore_orders validate constraint webstore_orders_tax_rate_range;
alter table public.webstore_orders validate constraint webstore_orders_stripe_fee_nonnegative;

-- Historical ship-home orders retain an auditable destination in their saved
-- address.  Do not invent a historical rate: only the state/source can be
-- backfilled safely.  SO-2313 is the audited exception—the 30 orders were
-- independently verified at California 7.75%, so preserve that known decision.
update public.webstore_orders
set tax_state = upper(ship_address ->> 'state'),
    tax_source = coalesce(tax_source, 'historical_shipping_address')
where tax_state is null
  and ship_address is not null
  and upper(ship_address ->> 'state') ~ '^[A-Z]{2}$';

update public.webstore_orders
set tax_state = 'CA',
    tax_rate = 0.077500,
    tax_source = 'historical_audit_backfill'
where so_id = 'SO-2313'
  and store_id = '2cbc4dc1-7e98-4364-aaf2-a82fdb0d08dc'::uuid
  and coalesce(tax, 0) > 0
  and tax_state is null;

create unique index if not exists webstore_orders_stripe_charge_id_uidx
  on public.webstore_orders (stripe_charge_id)
  where stripe_charge_id is not null;
create unique index if not exists webstore_orders_stripe_balance_transaction_id_uidx
  on public.webstore_orders (stripe_balance_transaction_id)
  where stripe_balance_transaction_id is not null;

create table if not exists public.stripe_payouts (
  stripe_payout_id text primary key,
  amount_cents bigint not null,
  currency text not null,
  status text not null,
  automatic boolean not null default false,
  method text,
  destination_type text,
  arrival_date date,
  stripe_created_at timestamptz,
  balance_transaction_count integer,
  activity_amount_cents bigint,
  fee_cents bigint,
  net_cents bigint,
  webstore_net_cents bigint,
  unlinked_net_cents bigint,
  reconciliation_difference_cents bigint,
  reconciliation_status text not null default 'pending',
  reconciled_at timestamptz,
  failure_code text,
  failure_message text,
  qbo_deposit_id text,
  qbo_posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_payouts_id_format check (stripe_payout_id ~ '^po_[A-Za-z0-9_]+$'),
  constraint stripe_payouts_currency_format check (currency ~ '^[a-z]{3}$'),
  constraint stripe_payouts_reconciliation_status_check check (
    reconciliation_status in ('pending', 'exact', 'mismatch', 'unavailable', 'failed')
  ),
  constraint stripe_payouts_count_nonnegative check (
    balance_transaction_count is null or balance_transaction_count >= 0
  )
);

create table if not exists public.stripe_balance_transactions (
  stripe_balance_transaction_id text primary key,
  stripe_payout_id text references public.stripe_payouts(stripe_payout_id) on delete set null,
  source_id text,
  source_type text,
  payment_intent_id text,
  webstore_order_id uuid references public.webstore_orders(id) on delete set null,
  reporting_category text not null,
  transaction_type text not null,
  status text not null,
  currency text not null,
  amount_cents bigint not null,
  fee_cents bigint not null,
  net_cents bigint not null,
  fee_details jsonb not null default '[]'::jsonb,
  stripe_created_at timestamptz not null,
  available_on timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_balance_transactions_id_format check (
    stripe_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'
  ),
  constraint stripe_balance_transactions_currency_format check (currency ~ '^[a-z]{3}$'),
  constraint stripe_balance_transactions_money_reconciles check (
    net_cents = amount_cents - fee_cents
  )
);

create index if not exists stripe_balance_transactions_payout_idx
  on public.stripe_balance_transactions (stripe_payout_id, stripe_created_at);
create index if not exists stripe_balance_transactions_order_idx
  on public.stripe_balance_transactions (webstore_order_id, stripe_created_at)
  where webstore_order_id is not null;
create index if not exists stripe_balance_transactions_payment_intent_idx
  on public.stripe_balance_transactions (payment_intent_id)
  where payment_intent_id is not null;
create index if not exists stripe_payouts_reconciliation_queue_idx
  on public.stripe_payouts (stripe_created_at)
  where reconciliation_status in ('pending', 'mismatch', 'failed');

-- One row per accounting component.  These rows intentionally carry semantic
-- account keys, not QBO IDs: live account IDs are still resolved and type-
-- checked against the configured chart before any eventual QBO write.
create or replace view public.stripe_payout_qbo_entries
with (security_invoker = true)
as
with linked_charge as (
  select
    bt.*,
    o.subtotal,
    o.fundraise_amt,
    o.shipping_fee,
    o.processing_fee,
    o.discount_amt,
    o.tax,
    o.tax_state,
    round(coalesce(o.total, 0) * 100)::bigint as order_total_cents
  from public.stripe_balance_transactions bt
  left join public.webstore_orders o on o.id = bt.webstore_order_id
),
components as (
  select
    lc.stripe_payout_id,
    lc.stripe_balance_transaction_id,
    lc.webstore_order_id,
    entry.entry_type,
    entry.posting_account_key,
    entry.tax_state,
    entry.amount_cents,
    entry.qbo_ready
  from linked_charge lc
  cross join lateral (values
    ('product_sales', 'income_account', null::text,
      round(coalesce(lc.subtotal, 0) * 100)::bigint, true),
    ('fundraising', 'review_required', null::text,
      round(coalesce(lc.fundraise_amt, 0) * 100)::bigint, false),
    ('customer_shipping', 'income_account', null::text,
      round(coalesce(lc.shipping_fee, 0) * 100)::bigint, true),
    ('customer_processing_fee', 'income_account', null::text,
      round(coalesce(lc.processing_fee, 0) * 100)::bigint, true),
    ('customer_discount', 'discount_account', null::text,
      -round(coalesce(lc.discount_amt, 0) * 100)::bigint, true),
    ('sales_tax',
      case when lc.tax_state in ('CA','AZ','CO','NV','TX','WA')
        then 'tax_' || lower(lc.tax_state) || '_account'
        else 'tax_parent_account' end,
      lc.tax_state,
      round(coalesce(lc.tax, 0) * 100)::bigint,
      lc.tax_state in ('CA','AZ','CO','NV','TX','WA'))
  ) entry(entry_type, posting_account_key, tax_state, amount_cents, qbo_ready)
  where lc.reporting_category = 'charge'
    and lc.webstore_order_id is not null
    and lc.amount_cents = lc.order_total_cents
    and entry.amount_cents <> 0
),
review_activity as (
  select
    lc.stripe_payout_id,
    lc.stripe_balance_transaction_id,
    lc.webstore_order_id,
    'stripe_' || lc.reporting_category as entry_type,
    'review_required' as posting_account_key,
    lc.tax_state,
    lc.amount_cents,
    false as qbo_ready
  from linked_charge lc
  where not (
    lc.reporting_category = 'charge'
    and lc.webstore_order_id is not null
    and lc.amount_cents = lc.order_total_cents
  )
    and lc.amount_cents <> 0
),
fees as (
  select
    lc.stripe_payout_id,
    lc.stripe_balance_transaction_id,
    lc.webstore_order_id,
    'stripe_fee' as entry_type,
    'omg_card_fee_account' as posting_account_key,
    lc.tax_state,
    -lc.fee_cents as amount_cents,
    true as qbo_ready
  from linked_charge lc
  where lc.fee_cents <> 0
)
select * from components
union all
select * from review_activity
union all
select * from fees;

comment on view public.stripe_payout_qbo_entries is
  'Service-only, cent-exact semantic posting rows for Stripe payouts. review_required rows must be resolved before creating a QBO deposit.';

alter table public.stripe_payouts enable row level security;
alter table public.stripe_balance_transactions enable row level security;

revoke all on table public.stripe_payouts from public, anon, authenticated;
revoke all on table public.stripe_balance_transactions from public, anon, authenticated;
revoke all on table public.stripe_payout_qbo_entries from public, anon, authenticated;

grant select, insert, update on table public.stripe_payouts to service_role;
grant select, insert, update on table public.stripe_balance_transactions to service_role;
grant select on table public.stripe_payout_qbo_entries to service_role;
