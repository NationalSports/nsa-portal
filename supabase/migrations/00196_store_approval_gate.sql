-- 00196_store_approval_gate.sql
-- Store approval gate — Phase 1 of PUBLIC_STORE_BUILDER_PLAN_2026-07-16.md.
--
-- Model (owner decision, 2026-07-16): a public-built store publishes live and captures
-- payment immediately, but NOTHING on it may reach production until staff approve the
-- store (<=24h review). Reject => refund + close (Phase 3). This migration is the
-- structural half of that promise: it makes it impossible, at the database level, for an
-- order on an unapproved store to become production work.
--
-- Design choice: table-level BEFORE triggers, NOT edits to create_teamshop_sales_order /
-- advance_job_stage. Those two functions live only in the live DB (their migrations were
-- applied via MCP; the SQL isn't in this repo), so replacing their bodies here would
-- create a hand-synced 16KB copy that silently drifts — this repo's dominant failure mode
-- (see FABLE_WORKING_PROCESS.md §1). Triggers gate the TABLES every conversion path must
-- write through, so any current or future path (teamshop RPC, manual staff SO creation,
-- new automation) hits the same wall.
--
-- Naming note: the live DB's applied-migration list has its own name sequence in which
-- 00196..00220 are teamshop migrations. This repo's file sequence is independent (files
-- here end at 00195); the version timestamp is the real key. Do not "fix" the numbers.
--
-- What blocks WHERE:
--   1. sales_orders BEFORE INSERT / UPDATE OF webstore_id — an SO for an unapproved
--      store cannot exist. Starves so_jobs, auto-art, auto-PO, DTF needs, releases.
--   2. so_jobs BEFORE INSERT / UPDATE OF prod_status — a job on an unapproved store's SO
--      cannot enter production stages (covers approve-then-reject windows and any
--      direct-write path that authorizes past guard_teamshop_stage).
--   3. webstores BEFORE INSERT — created_via='public' is FORCED to pending_review at
--      birth (+24h deadline). Phase 2's public builder cannot forget to set it.
--   Payment capture (place_webstore_order) is deliberately NOT gated — capture-now is
--   the owner's model; orders on pending stores sit paid + unconverted ("held").
--
-- Loud, not silent (FABLE_WORKING_PROCESS.md §5): violations RAISE
-- 'NSA_STORE_UNAPPROVED:<status>' in the same NSA_* convention as the live RPCs, so a
-- misbehaving caller fails visibly instead of no-op'ing.

-- ── Columns ─────────────────────────────────────────────────────────────────────────
-- Default 'approved': every existing store (24 live today) and every staff/coach-built
-- store keeps working exactly as before. Only explicitly-marked stores are gated.

alter table public.webstores
  add column if not exists approval_status   text not null default 'approved',
  add column if not exists approval_deadline timestamptz,
  add column if not exists approved_by       text,
  add column if not exists approved_at       timestamptz,
  add column if not exists rejected_reason   text;

alter table public.webstores drop constraint if exists webstores_approval_status_chk;
alter table public.webstores add constraint webstores_approval_status_chk
  check (approval_status in ('pending_review', 'approved', 'rejected'));

-- ── 1. Gate SO creation ─────────────────────────────────────────────────────────────
-- Missing store row for a non-null webstore_id is treated as approved (legacy/dangling
-- ids predate this gate and cannot be a public pending store); a real pending/rejected
-- store raises.

create or replace function public.enforce_store_approval_so()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_appr text;
begin
  if new.webstore_id is null then
    return new;
  end if;
  select approval_status into v_appr from webstores where id = new.webstore_id;
  if coalesce(v_appr, 'approved') <> 'approved' then
    raise exception 'NSA_STORE_UNAPPROVED:%', v_appr;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_store_approval_so on public.sales_orders;
create trigger trg_enforce_store_approval_so
  before insert or update of webstore_id on public.sales_orders
  for each row
  when (new.webstore_id is not null)
  execute function public.enforce_store_approval_so();

-- ── 2. Gate production-stage entry on jobs ──────────────────────────────────────────
-- Only transitions INTO staging/in_process/completed are gated ('hold' stays free so
-- staff can always park work). Non-webstore SOs (no webstore_id / no matching store row)
-- pass — this gate is only about store approval.
-- Trigger-order note: 'trg_enforce…' sorts before 'trg_guard_teamshop_stage', so an
-- unapproved release raises loudly here before the stage guard would silently revert it.
-- That ordering is a nicety, not a dependency — either order blocks the write.

create or replace function public.enforce_store_approval_job()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_appr text;
begin
  if coalesce(new.prod_status, '') not in ('staging', 'in_process', 'completed') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.prod_status is not distinct from old.prod_status then
    return new;
  end if;
  select w.approval_status into v_appr
    from sales_orders so
    join webstores w on w.id = so.webstore_id
   where so.id = new.so_id;
  if v_appr is not null and v_appr <> 'approved' then
    raise exception 'NSA_STORE_UNAPPROVED:%', v_appr;
  end if;
  return new;
end $$;

drop trigger if exists trg_enforce_store_approval_job on public.so_jobs;
create trigger trg_enforce_store_approval_job
  before insert or update of prod_status on public.so_jobs
  for each row
  execute function public.enforce_store_approval_job();

-- ── 3. Public-built stores are born pending ─────────────────────────────────────────
-- Structural default, not a convention: the Phase-2 public builder marks its stores
-- created_via='public', and this trigger makes it impossible for such a store to start
-- life approved — even if the builder code forgets, or a later caller passes
-- approval_status='approved' explicitly.

create or replace function public.force_public_store_pending()
returns trigger
language plpgsql security definer set search_path = 'public'
as $$
begin
  if coalesce(new.created_via, '') = 'public' then
    new.approval_status   := 'pending_review';
    new.approval_deadline := coalesce(new.approval_deadline, now() + interval '24 hours');
  end if;
  return new;
end $$;

drop trigger if exists trg_force_public_store_pending on public.webstores;
create trigger trg_force_public_store_pending
  before insert on public.webstores
  for each row
  execute function public.force_public_store_pending();

-- ── Post-conditions ─────────────────────────────────────────────────────────────────
-- A migration that reports success while changing nothing is worse than one that fails
-- (FABLE_WORKING_PROCESS.md §5). Assert the end state actually holds.

do $$
begin
  assert exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'webstores'
                   and column_name = 'approval_status'),
    'webstores.approval_status missing';
  assert (select count(*) from public.webstores where approval_status <> 'approved') = 0,
    'existing stores must all backfill to approved';
  assert exists (select 1 from pg_trigger
                 where tgname = 'trg_enforce_store_approval_so' and not tgisinternal),
    'sales_orders approval trigger missing';
  assert exists (select 1 from pg_trigger
                 where tgname = 'trg_enforce_store_approval_job' and not tgisinternal),
    'so_jobs approval trigger missing';
  assert exists (select 1 from pg_trigger
                 where tgname = 'trg_force_public_store_pending' and not tgisinternal),
    'webstores public-pending trigger missing';
  assert position('NSA_STORE_UNAPPROVED' in pg_get_functiondef('public.enforce_store_approval_so()'::regprocedure)) > 0,
    'SO gate function lacks the loud failure';
end $$;
