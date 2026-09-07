-- Replace app_state.omg_tax_remit's cumulative store/state flag with an
-- append-only filing ledger.  A filing records exactly what was remitted
-- through a cutoff; later collections therefore remain outstanding.  Mistakes
-- are corrected by a separate reversal row, never by rewriting history.

create table if not exists public.sales_tax_remittance_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null default 'remittance',
  reversal_of uuid references public.sales_tax_remittance_ledger(id),
  source_type text not null,
  source_key text not null,
  store_name text not null,
  jurisdiction text not null,
  filing_period_start date not null,
  filing_period_end date not null,
  cutoff_at timestamptz not null,
  amount_cents bigint not null,
  payment_reference text,
  notes text,
  recorded_by text,
  recorded_at timestamptz not null default now(),
  idempotency_key text not null unique,
  legacy_import boolean not null default false,
  constraint sales_tax_remittance_entry_type_check
    check (entry_type in ('remittance', 'reversal')),
  constraint sales_tax_remittance_source_type_check
    check (source_type in ('omg', 'webstore')),
  constraint sales_tax_remittance_amount_positive
    check (amount_cents > 0),
  constraint sales_tax_remittance_period_order
    check (filing_period_start <= filing_period_end),
  constraint sales_tax_remittance_cutoff_order
    check (cutoff_at::date >= filing_period_end),
  constraint sales_tax_remittance_jurisdiction_check
    check (
      jurisdiction ~ '^[A-Z]{2}$'
      or (legacy_import and jurisdiction = 'UNKNOWN')
    ),
  constraint sales_tax_remittance_reversal_shape
    check (
      (entry_type = 'remittance' and reversal_of is null)
      or (entry_type = 'reversal' and reversal_of is not null)
    ),
  constraint sales_tax_remittance_reference_required
    check (
      entry_type = 'reversal'
      or legacy_import
      or nullif(btrim(payment_reference), '') is not null
    )
);

create unique index if not exists sales_tax_remittance_one_reversal_uidx
  on public.sales_tax_remittance_ledger (reversal_of)
  where reversal_of is not null;

create index if not exists sales_tax_remittance_source_cutoff_idx
  on public.sales_tax_remittance_ledger (source_key, jurisdiction, cutoff_at desc);

create index if not exists sales_tax_remittance_jurisdiction_period_idx
  on public.sales_tax_remittance_ledger (jurisdiction, filing_period_end desc);

comment on table public.sales_tax_remittance_ledger is
  'Append-only sales-tax filing/remittance audit trail. Reversals are new rows; UPDATE and DELETE are intentionally not granted.';
comment on column public.sales_tax_remittance_ledger.cutoff_at is
  'Latest collection timestamp included in this remittance; collections after it remain outstanding.';

-- Preserve any prior marks without pretending their unknown filing periods or
-- payment references were captured.  The legacy app_state row remains intact
-- as raw historical evidence and is no longer written by the application.
with legacy_entries as (
  select legacy.key as source_key, legacy.value as record
  from public.app_state state
  cross join lateral jsonb_each(state.value::jsonb) legacy
  where state.id = 'omg_tax_remit'
    and jsonb_typeof(state.value::jsonb) = 'object'
), normalized as (
  select
    source_key,
    record,
    case when source_key like 'ws:%' then 'webstore' else 'omg' end as source_type,
    coalesce(nullif(record ->> 'at', '')::timestamptz, now()) as recorded_at,
    round(coalesce((record ->> 'amount')::numeric, 0) * 100)::bigint as amount_cents
  from legacy_entries
)
insert into public.sales_tax_remittance_ledger (
  entry_type, source_type, source_key, store_name, jurisdiction,
  filing_period_start, filing_period_end, cutoff_at, amount_cents,
  payment_reference, notes, recorded_by, recorded_at, idempotency_key,
  legacy_import
)
select
  'remittance',
  n.source_type,
  n.source_key,
  coalesce(w.name, o.store_name, n.source_key),
  case
    when n.source_type = 'webstore' then upper(regexp_replace(n.source_key, '^.*:', ''))
    else coalesce(nullif(upper(c.shipping_state), ''), nullif(upper(c.billing_state), ''), 'UNKNOWN')
  end,
  n.recorded_at::date,
  n.recorded_at::date,
  n.recorded_at,
  n.amount_cents,
  null,
  'Migrated from legacy cumulative flag; original filing period and payment reference were not captured.',
  n.record ->> 'by',
  n.recorded_at,
  'legacy-app-state:' || n.source_key,
  true
from normalized n
left join public.webstores w
  on n.source_type = 'webstore'
 and w.id::text = split_part(n.source_key, ':', 2)
left join public.omg_stores o
  on n.source_type = 'omg'
 and o.id = n.source_key
left join public.customers c on c.id = o.customer_id
where n.amount_cents > 0
on conflict (idempotency_key) do nothing;

alter table public.sales_tax_remittance_ledger enable row level security;

revoke all on table public.sales_tax_remittance_ledger from public, anon, authenticated;
revoke all on table public.sales_tax_remittance_ledger from service_role;
grant select, insert on table public.sales_tax_remittance_ledger to service_role;
