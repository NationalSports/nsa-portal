-- Read-only QBO reconciliation foundation. No invoice/payment write permission
-- or scheduler is introduced. A crashed run deliberately requires operator review.
create table public.qbo_review_runs (
  id uuid primary key,
  company_key text not null check (company_key = 'national'),
  realm_id text not null check (realm_id ~ '^[0-9]+$'),
  status text not null check (status in ('running','complete','needs_review','failed','abandoned')),
  requested_by text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  report jsonb,
  error_code text,
  check ((status = 'running') = (finished_at is null))
);
create unique index qbo_review_one_running on public.qbo_review_runs(company_key)
  where status = 'running';
create index qbo_review_history on public.qbo_review_runs(company_key, started_at desc);
alter table public.qbo_review_runs enable row level security;
revoke all on public.qbo_review_runs from public, anon, authenticated;
grant select, insert, update on public.qbo_review_runs to service_role;

-- One statement snapshot prevents paging through a changing invoice population.
-- This includes deleted/void/unlinked rows so exclusions are explicit evidence.
create function public.qbo_review_invoice_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'customer_id', customer_id, 'total', total, 'paid', paid,
    'status', status, 'qb_invoice_id', qb_invoice_id, 'deleted_at', deleted_at
  ) order by id), '[]'::jsonb) from public.invoices;
$$;
revoke all on function public.qbo_review_invoice_snapshot() from public, anon, authenticated;
grant execute on function public.qbo_review_invoice_snapshot() to service_role;
