-- Durable, read-only vendor-bill readiness reviews. This introduces no QBO
-- transaction writer and is intentionally service-role-only.
create table public.qbo_payable_review_runs (
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

create unique index qbo_payable_review_one_running
  on public.qbo_payable_review_runs(company_key) where status = 'running';
create index qbo_payable_review_history
  on public.qbo_payable_review_runs(company_key, started_at desc);

alter table public.qbo_payable_review_runs enable row level security;
revoke all on public.qbo_payable_review_runs from public, anon, authenticated;
grant select, insert, update on public.qbo_payable_review_runs to service_role;
