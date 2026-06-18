-- so_save_audit — append-only capture of real sales-order saves for the shadow
-- A/B harness. The future transactional save_sales_order RPC will be validated by
-- replaying these captured saves and diffing its output against `result`.
--
-- Written only by the capture-so-save edge function (service role). RLS is enabled
-- with NO policies, so the table is locked to the service role — the browser (anon
-- OR authenticated) can neither read nor write it. It holds order data, so this
-- lockdown is deliberate.

create table if not exists public.so_save_audit (
  id         bigint generated always as identity primary key,
  so_id      text not null,
  saved_by   text,                 -- auth uid of the staff member who saved
  payload    jsonb not null,       -- the in-memory SO object that was saved (replay INPUT)
  result     jsonb,                -- snapshot of the persisted rows after the save (expected OUTPUT)
  created_at timestamptz not null default now()
);

create index if not exists so_save_audit_so_id_idx      on public.so_save_audit (so_id);
create index if not exists so_save_audit_created_at_idx  on public.so_save_audit (created_at desc);

alter table public.so_save_audit enable row level security;
-- Intentionally no policies: only the service role (which is RLS-exempt) may
-- read or write this table. The capture endpoint uses the service role.
