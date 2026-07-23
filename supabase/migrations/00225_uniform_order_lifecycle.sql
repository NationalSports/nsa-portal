-- Durable lifecycle for custom Uniform Builder orders.
--
-- Browser clients never write these tables directly. Public coach actions go
-- through the uniform-order Netlify function, which validates the secret order
-- token and uses the service role. Authenticated staff retain their existing
-- portal access through is_team_member().

create table if not exists public.uniform_order_requests (
  id uuid primary key default gen_random_uuid(),
  team_name text not null default 'Team',
  sport text,
  contact_name text,
  contact_email text,
  config jsonb not null default '{}'::jsonb,
  spec jsonb not null default '{}'::jsonb,
  bottom_spec jsonb,
  roster jsonb not null default '[]'::jsonb,
  total_qty integer not null default 0,
  unit_price numeric not null default 0,
  total numeric not null default 0,
  fulfillment text not null default 'manual',
  status text not null default 'queued',
  po_number text,
  po_contact text,
  stripe_intent_id text,
  thumb text,
  created_at timestamptz not null default now()
);

create sequence if not exists public.uniform_order_number_seq start with 1001;

alter table public.uniform_order_requests
  add column if not exists order_number text,
  add column if not exists client_ref text,
  add column if not exists public_token uuid default gen_random_uuid(),
  add column if not exists production_status text not null default 'submitted',
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists assigned_rep_id text,
  add column if not exists rep_review_notes text,
  add column if not exists proof_version integer not null default 0,
  add column if not exists approved_proof_version integer,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_name text,
  add column if not exists approved_by_email text,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists production_started_at timestamptz,
  add column if not exists quality_checked_at timestamptz,
  add column if not exists carrier text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists shipped_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists parent_order_id uuid,
  add column if not exists back_thumb text,
  add column if not exists public_unit_price numeric not null default 0,
  add column if not exists discount_percent numeric(5,2) not null default 0,
  add column if not exists discount_total numeric not null default 0,
  add column if not exists pricing_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists last_customer_note text,
  add column if not exists updated_at timestamptz not null default now();

update public.uniform_order_requests
set public_token = gen_random_uuid()
where public_token is null;

alter table public.uniform_order_requests
  alter column public_token set default gen_random_uuid(),
  alter column public_token set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniform_order_requests_assigned_rep_fkey'
  ) then
    alter table public.uniform_order_requests
      add constraint uniform_order_requests_assigned_rep_fkey
      foreign key (assigned_rep_id) references public.team_members(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniform_order_requests_parent_order_fkey'
  ) then
    alter table public.uniform_order_requests
      add constraint uniform_order_requests_parent_order_fkey
      foreign key (parent_order_id) references public.uniform_order_requests(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniform_order_requests_production_status_check'
  ) then
    alter table public.uniform_order_requests
      add constraint uniform_order_requests_production_status_check check (
        production_status in (
          'submitted', 'rep_review', 'proof_ready', 'changes_requested',
          'approved', 'production', 'quality_check', 'shipped',
          'delivered', 'cancelled'
        )
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'uniform_order_requests_payment_status_check'
  ) then
    alter table public.uniform_order_requests
      add constraint uniform_order_requests_payment_status_check check (
        payment_status in ('unpaid', 'pending', 'paid', 'po_terms', 'refunded', 'void')
      );
  end if;
end $$;

create unique index if not exists uniform_order_requests_order_number_uidx
  on public.uniform_order_requests(order_number)
  where order_number is not null;
create unique index if not exists uniform_order_requests_client_ref_uidx
  on public.uniform_order_requests(client_ref)
  where client_ref is not null;
create unique index if not exists uniform_order_requests_public_token_uidx
  on public.uniform_order_requests(public_token);
create index if not exists uniform_order_requests_lifecycle_idx
  on public.uniform_order_requests(production_status, payment_status, created_at desc);
create index if not exists uniform_order_requests_contact_idx
  on public.uniform_order_requests(lower(contact_email), created_at desc);

create or replace function public.assign_uniform_order_number()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.order_number is null or btrim(new.order_number) = '' then
    new.order_number := 'UB-' || lpad(nextval('public.uniform_order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_uniform_order_number on public.uniform_order_requests;
create trigger trg_uniform_order_number
before insert on public.uniform_order_requests
for each row execute function public.assign_uniform_order_number();

-- Number any pre-lifecycle rows without changing their original state.
update public.uniform_order_requests
set order_number = 'UB-' || lpad(nextval('public.uniform_order_number_seq')::text, 6, '0')
where order_number is null;

drop trigger if exists trg_uniform_order_requests_updated on public.uniform_order_requests;
create trigger trg_uniform_order_requests_updated
before update on public.uniform_order_requests
for each row execute function public.set_updated_at();

create table if not exists public.uniform_order_proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.uniform_order_requests(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null default '{}'::jsonb,
  front_image text,
  back_image text,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  customer_decision text check (customer_decision is null or customer_decision in ('approved', 'changes_requested')),
  customer_note text,
  decided_at timestamptz,
  unique (order_id, version)
);

create index if not exists uniform_order_proofs_order_idx
  on public.uniform_order_proofs(order_id, version desc);

create table if not exists public.uniform_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.uniform_order_requests(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('coach', 'staff', 'system')),
  actor_name text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists uniform_order_events_order_idx
  on public.uniform_order_events(order_id, created_at asc, id asc);

-- Once production is locked, the approved artwork/spec/roster/pricing cannot be
-- silently altered. Staff can still move the order through production and add
-- tracking. A reorder creates a new unlocked child order instead.
create or replace function public.protect_locked_uniform_order()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.locked_at is not null and (
    new.team_name is distinct from old.team_name or
    new.sport is distinct from old.sport or
    new.config is distinct from old.config or
    new.spec is distinct from old.spec or
    new.bottom_spec is distinct from old.bottom_spec or
    new.roster is distinct from old.roster or
    new.total_qty is distinct from old.total_qty or
    new.unit_price is distinct from old.unit_price or
    new.total is distinct from old.total or
    new.pricing_breakdown is distinct from old.pricing_breakdown or
    new.fulfillment is distinct from old.fulfillment or
    new.po_number is distinct from old.po_number or
    new.stripe_intent_id is distinct from old.stripe_intent_id
  ) then
    raise exception 'This uniform order is locked for production. Create a reorder to change its approved specifications.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_locked_uniform_order on public.uniform_order_requests;
create trigger trg_protect_locked_uniform_order
before update on public.uniform_order_requests
for each row execute function public.protect_locked_uniform_order();

alter table public.uniform_order_requests enable row level security;
alter table public.uniform_order_proofs enable row level security;
alter table public.uniform_order_events enable row level security;

drop policy if exists uniform_order_requests_staff_all on public.uniform_order_requests;
create policy uniform_order_requests_staff_all
on public.uniform_order_requests for all to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists uniform_order_proofs_staff_all on public.uniform_order_proofs;
create policy uniform_order_proofs_staff_all
on public.uniform_order_proofs for all to authenticated
using (public.is_team_member())
with check (public.is_team_member());

drop policy if exists uniform_order_events_staff_all on public.uniform_order_events;
create policy uniform_order_events_staff_all
on public.uniform_order_events for all to authenticated
using (public.is_team_member())
with check (public.is_team_member());

revoke all on table public.uniform_order_requests from anon;
revoke all on table public.uniform_order_proofs from anon;
revoke all on table public.uniform_order_events from anon;
revoke all on sequence public.uniform_order_number_seq from anon, authenticated;

grant select, insert, update, delete on table public.uniform_order_requests to authenticated;
grant select, insert, update, delete on table public.uniform_order_proofs to authenticated;
grant select, insert, update, delete on table public.uniform_order_events to authenticated;
grant all on table public.uniform_order_requests to service_role;
grant all on table public.uniform_order_proofs to service_role;
grant all on table public.uniform_order_events to service_role;
grant usage, select on sequence public.uniform_order_number_seq to service_role;
grant usage, select on sequence public.uniform_order_events_id_seq to service_role;

comment on table public.uniform_order_proofs is
  'Immutable versioned production-proof snapshots for Uniform Builder orders.';
comment on table public.uniform_order_events is
  'Customer-visible and internal lifecycle audit trail for Uniform Builder orders.';
comment on column public.uniform_order_requests.public_token is
  'Unpredictable bearer token used only by the server status endpoint; never exposed through an open table policy.';
