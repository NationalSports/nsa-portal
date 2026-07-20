-- Uniform Builder hardening (review follow-ups to 00223–00227).
--
-- 1. Bring uniform_designs / uniform_patterns into the repo migration chain
--    (they predate it in prod — created ad hoc, then locked by 00179) so fresh
--    and branch databases get the same tables and the same staff-only posture.
-- 2. Close the lock-bypass: protect locked_at itself and the customer-facing
--    money columns, and forbid deleting a locked production record.
-- 3. Make sure uniform_settings has the staff policy on fresh databases
--    (00225 creates the table there; prod already has the policy via 00179).

-- ── 1. Designs + patterns: tables and staff-only posture ─────────────────────
create table if not exists public.uniform_designs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null default 'Custom Uniform',
  garment_id  text,
  spec        jsonb not null,
  thumb       text,
  owner       uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists uniform_designs_created_at_idx on public.uniform_designs (created_at desc);

create table if not exists public.uniform_patterns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  image       text not null,
  active      boolean not null default true,
  tintable    boolean not null default false,
  tint_mode   text not null default 'solid',
  created_at  timestamptz not null default now()
);
create index if not exists uniform_patterns_active_idx on public.uniform_patterns (active, created_at desc);

alter table public.uniform_designs enable row level security;
alter table public.uniform_patterns enable row level security;
alter table public.uniform_settings enable row level security;

-- Drop the permissive policies from the pre-lockdown root files wherever they
-- were ever applied, then assert the staff-only policy (idempotent re-create).
-- The public builder reads patterns/settings and saves designs only through
-- the service-role uniform-builder-data function.
drop policy if exists uniform_designs_anon_insert on public.uniform_designs;
drop policy if exists uniform_designs_anon_select on public.uniform_designs;
drop policy if exists uniform_designs_staff_all on public.uniform_designs;
create policy uniform_designs_staff_all on public.uniform_designs
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

drop policy if exists uniform_patterns_public_select on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_insert on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_update on public.uniform_patterns;
drop policy if exists uniform_patterns_auth_delete on public.uniform_patterns;
drop policy if exists uniform_patterns_staff_all on public.uniform_patterns;
create policy uniform_patterns_staff_all on public.uniform_patterns
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

drop policy if exists uniform_order_requests_public_insert on public.uniform_order_requests;
drop policy if exists uniform_order_requests_staff_select on public.uniform_order_requests;
drop policy if exists uniform_order_requests_staff_update on public.uniform_order_requests;
drop policy if exists uniform_order_requests_staff_delete on public.uniform_order_requests;

drop policy if exists uniform_settings_staff_all on public.uniform_settings;
create policy uniform_settings_staff_all on public.uniform_settings
  for all to authenticated
  using (public.is_team_member()) with check (public.is_team_member());

revoke select, insert, update, delete on public.uniform_designs from anon;
revoke select, insert, update, delete on public.uniform_patterns from anon;
revoke select, insert, update, delete on public.uniform_settings from anon;

-- ── 2. The lock protects the lock ────────────────────────────────────────────
-- 00224's trigger froze the production spec but left locked_at itself and the
-- customer-facing discount math editable, so a locked order could be silently
-- unlocked, edited, and relocked. Now: once locked, locked_at is immutable
-- (unlock = a future migration, deliberately), the whole money snapshot is
-- frozen, and the row cannot be deleted out from under its proofs and events.
create or replace function public.protect_locked_uniform_order()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.locked_at is not null and new.locked_at is distinct from old.locked_at then
    raise exception 'A locked uniform order cannot be unlocked. Create a reorder to change its approved specifications.';
  end if;
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
    new.public_unit_price is distinct from old.public_unit_price or
    new.discount_percent is distinct from old.discount_percent or
    new.discount_total is distinct from old.discount_total or
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

create or replace function public.protect_locked_uniform_order_delete()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if old.locked_at is not null then
    raise exception 'A locked uniform order is a production record and cannot be deleted.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_locked_uniform_order_delete on public.uniform_order_requests;
create trigger trg_protect_locked_uniform_order_delete
before delete on public.uniform_order_requests
for each row execute function public.protect_locked_uniform_order_delete();
