-- Customer-centered accounts-receivable workflow.
--
-- The financial facts remain derived from invoices/orders. This migration stores
-- only the human workflow around those facts and a once-per-day management
-- snapshot, so accounting and the assigned rep share one durable operating view.

begin;

create table if not exists public.ar_account_workflows (
  customer_id          text primary key references public.customers(id) on delete cascade,
  collection_owner_id  text references public.team_members(id) on delete set null,
  status               text not null default 'needs_contact'
                       check (status in ('needs_contact','waiting_customer','rep_action','accounting_followup','monitoring','complete')),
  next_action_date     date,
  last_contacted_at    timestamptz,
  notes                text,
  updated_by           text references public.team_members(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists ar_account_workflows_owner_idx
  on public.ar_account_workflows (collection_owner_id, next_action_date);
create index if not exists ar_account_workflows_status_idx
  on public.ar_account_workflows (status, next_action_date);

create table if not exists public.ar_daily_snapshots (
  id                     bigserial primary key,
  as_of_date             date not null,
  scope_id               text not null, -- 'team' or team_members.id
  scope_name             text,
  total_ar               numeric not null default 0,
  past_due               numeric not null default 0,
  d60plus                numeric not null default 0,
  d90plus                numeric not null default 0,
  completed_uninvoiced   numeric not null default 0,
  open_order_value       numeric not null default 0,
  forecast_7             numeric not null default 0,
  forecast_30            numeric not null default 0,
  forecast_60            numeric not null default 0,
  account_count          integer not null default 0,
  invoice_count          integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (as_of_date, scope_id)
);

create index if not exists ar_daily_snapshots_scope_date_idx
  on public.ar_daily_snapshots (scope_id, as_of_date desc);

alter table public.ar_account_workflows enable row level security;
alter table public.ar_daily_snapshots enable row level security;

-- Messages are otherwise intentionally shared across staff. Make only the new
-- customer-level AR threads restrictive: management/accounting see all, while
-- a rep can read or write threads for accounts currently assigned to them.
drop policy if exists messages_ar_customer_scope on public.messages;
create policy messages_ar_customer_scope
  on public.messages
  as restrictive
  for all
  to authenticated
  using (
    coalesce(entity_type, 'so') <> 'customer'
    or exists (
      select 1
      from public.team_members tm
      join public.customers c on c.id = messages.entity_id
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (tm.role in ('admin','super_admin','gm','accounting') or c.primary_rep_id = tm.id)
    )
  )
  with check (
    coalesce(entity_type, 'so') <> 'customer'
    or exists (
      select 1
      from public.team_members tm
      join public.customers c on c.id = messages.entity_id
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (tm.role in ('admin','super_admin','gm','accounting') or c.primary_rep_id = tm.id)
    )
  );

-- Owners/admin/accounting operate the whole portfolio. A rep can only read or
-- change workflow attached to an account currently assigned to that rep.
drop policy if exists ar_account_workflows_staff_scope on public.ar_account_workflows;
create policy ar_account_workflows_staff_scope
  on public.ar_account_workflows
  for all
  to authenticated
  using (
    exists (
      select 1 from public.team_members tm
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (
          tm.role in ('admin','super_admin','gm','accounting')
          or exists (
            select 1 from public.customers c
            where c.id = ar_account_workflows.customer_id
              and c.primary_rep_id = tm.id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (
          tm.role in ('admin','super_admin','gm','accounting')
          or exists (
            select 1 from public.customers c
            where c.id = ar_account_workflows.customer_id
              and c.primary_rep_id = tm.id
          )
        )
    )
  );

-- Management roles can see/save team and rep history; reps only see/save their
-- own scope. The client never relies on hiding rows for authorization.
drop policy if exists ar_daily_snapshots_staff_scope on public.ar_daily_snapshots;
create policy ar_daily_snapshots_staff_scope
  on public.ar_daily_snapshots
  for all
  to authenticated
  using (
    exists (
      select 1 from public.team_members tm
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (tm.role in ('admin','super_admin','gm','accounting') or ar_daily_snapshots.scope_id = tm.id)
    )
  )
  with check (
    exists (
      select 1 from public.team_members tm
      where tm.auth_id = auth.uid() and tm.is_active is not false
        and (tm.role in ('admin','super_admin','gm','accounting') or ar_daily_snapshots.scope_id = tm.id)
    )
  );

commit;
