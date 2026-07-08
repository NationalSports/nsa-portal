-- Migration 00181: app_state hardening — atomic document counters
-- (DATA_PERSISTENCE_TIER2_PLAN.md item C, piece 1)
--
-- inv_po_counter / batch_counter / batch_vendor_counters were read-increment-write blobs in
-- app_state (whole-value last-write-wins): two machines advancing concurrently mint duplicate
-- document numbers. app_counters gives each key an atomic bigint; next_counter() bumps and
-- returns it in one statement. The client uses it for INVENTORY PO numbers ('PO <n> NSA'),
-- falling back to the legacy local counter while this migration isn't applied.
--
-- NOTE: batch PO numbers ('NSA <n>') are ALREADY allocated atomically at their real mint site
-- (order submission) by claim_batch_po_number (00161, batch_po_numbers table); batch_counter /
-- batch_vendor_counters only feed the pre-order PREVIEW number. Do NOT wire next_counter into
-- batch numbering — two independent allocators over the same NSA number space would collide.
-- The batch_counter / batch_vendor:* rows below are seeded for completeness only.

create table if not exists public.app_counters (
  key text primary key,
  value bigint not null default 0
);

alter table public.app_counters enable row level security;
-- No policies on purpose: only the security-definer function below touches it.

-- Seed best-effort from the legacy app_state blobs. app_state.value is TEXT holding
-- JSON.stringify output: plain counters are bare digit strings ('1023'), and
-- batch_vendor_counters is a JSON object ({"groupKey": 4512, ...}).
-- inv_po_counter/batch_counter store the NEXT number to mint, and legacy clients keep minting
-- from the app_state copy between this migration being applied and the client deploy — seed
-- +100 above them (072 precedent) so the sequence starts safely ahead of anything a not-yet-
-- deployed client can mint; skipped numbers are harmless gaps. Every read is exception-guarded
-- so a fresh DB (no app_state table/rows, or unparseable values) seeds the floors instead of
-- erroring.
do $$
declare v bigint;
begin
  begin
    select nullif(trim(value), '')::bigint into v from public.app_state where id = 'inv_po_counter';
  exception when others then v := null; -- app_state missing or value unparseable
  end;
  insert into public.app_counters(key, value)
  values ('inv_po_counter', greatest(coalesce(v, 0), 1001) + 100) -- 1001 = legacy client floor ('PO 1001 NSA')
  on conflict (key) do update set value = greatest(app_counters.value, excluded.value);

  begin
    select nullif(trim(value), '')::bigint into v from public.app_state where id = 'batch_counter';
  exception when others then v := null;
  end;
  insert into public.app_counters(key, value)
  values ('batch_counter', greatest(coalesce(v, 0), 4500) + 100) -- 4500 = 'NSA 4501' floor (00161)
  on conflict (key) do update set value = greatest(app_counters.value, excluded.value);

  begin
    insert into public.app_counters(key, value)
    select 'batch_vendor:' || t.k, t.val::bigint
    from public.app_state s, jsonb_each_text(s.value::jsonb) as t(k, val)
    where s.id = 'batch_vendor_counters' and t.val ~ '^[0-9]+$'
    on conflict (key) do update set value = greatest(app_counters.value, excluded.value);
  exception when others then null; -- blob missing or not a JSON object
  end;
end $$;

-- Atomically bump and return the counter for p_key. First call on a fresh key returns 1.
create or replace function public.next_counter(p_key text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  if not public.is_team_member() then
    raise exception 'next_counter: staff only';
  end if;
  insert into app_counters(key, value) values (p_key, 1)
  on conflict (key) do update set value = app_counters.value + 1
  returning value into v;
  return v;
end $$;

revoke all on function public.next_counter(text) from public;
revoke all on function public.next_counter(text) from anon;
grant execute on function public.next_counter(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Piece 2 — compare-and-swap for the money-bearing app_state keys
-- (labor_rates, comm_overrides). Both are whole-blob last-write-wins saves:
-- two admins editing rates in overlapping sessions silently revert each other.
-- app_state_cas writes only when the caller's hydrated row version still
-- matches (bumping it); -1 tells the caller to refetch + re-apply instead of
-- clobbering. Other app_state keys keep the plain upsert path and never touch
-- version.

alter table public.app_state add column if not exists version int not null default 0;

create or replace function public.app_state_cas(p_key text, p_expected int, p_value text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_new int;
begin
  if not public.is_team_member() then
    raise exception 'app_state_cas: staff only';
  end if;
  update app_state
     set value = p_value, version = version + 1, updated_at = now()
   where id = p_key and version = p_expected
   returning version into v_new;
  if v_new is not null then
    return v_new;
  end if;
  if p_expected = 0 then
    -- No row yet (first save of this key): create it at version 1. on conflict do nothing
    -- keeps a concurrent creator's row; FOUND is false then and we fall through to -1.
    insert into app_state(id, value, version, updated_at)
    values (p_key, p_value, 1, now())
    on conflict (id) do nothing;
    if found then return 1; end if;
  end if;
  return -1; -- version mismatch: caller refetches the row and re-applies
end $$;

revoke all on function public.app_state_cas(text, int, text) from public;
revoke all on function public.app_state_cas(text, int, text) from anon;
grant execute on function public.app_state_cas(text, int, text) to authenticated;
