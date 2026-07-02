-- Server-authoritative batch PO numbers.
--
-- Batch PO numbers ("NSA 4521") were minted entirely client-side from a high-water mark over
-- the submitted_batches app_state blob. That blob is whole-value last-write-wins, so two clients
-- ordering different vendor groups inside the same sync window could each derive the same
-- high-water mark and mint the same number — the "NSA 4513 x3" duplicate-PO bug. b808e41 fixed
-- the single-client regression; this closes the cross-client race.
--
-- claim_batch_po_number(p_number) atomically records the number the client is about to use:
--   * if p_number is free, it's claimed and returned unchanged (display == submitted, no gaps);
--   * if it's already taken (another client submitted it first), the next number above both the
--     table max and p_number is claimed and returned instead — the client warns the rep that the
--     batch was renumbered.
-- The client falls back to local numbering when this function isn't deployed yet, so deploy
-- order can't break batch ordering.

create table if not exists public.batch_po_numbers (
  n integer primary key,
  claimed_by text,
  claimed_at timestamptz not null default now()
);

alter table public.batch_po_numbers enable row level security;
-- No policies on purpose: only the security-definer function below writes it.

-- Seed with the current high-water mark from submitted_batches so the first claims can't reuse
-- history (a client with regressed local state could otherwise request an old number and win).
-- Defensive: any parse problem leaves the 4500 floor ("NSA 4501" was the first number ever issued).
do $$
declare
  v_max integer := 4500;
  v_n integer;
begin
  begin
    select max((regexp_match(elem->>'po_number','[0-9]{3,6}'))[1]::int) into v_n
    from public.app_state, jsonb_array_elements(value::jsonb) elem
    where id = 'submitted_batches' and elem->>'po_number' ~ '[0-9]';
    if v_n is not null and v_n > v_max then v_max := v_n; end if;
  exception when others then
    null; -- app_state missing or unparseable: keep the default floor
  end;
  insert into public.batch_po_numbers(n, claimed_by) values (v_max, 'migration-seed')
  on conflict (n) do nothing;
end $$;

create or replace function public.claim_batch_po_number(p_number integer, p_claimed_by text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  -- Serialize claims: one cheap single-row insert at a time beats unique-violation retry loops.
  perform pg_advisory_xact_lock(hashtext('batch_po_numbers'));
  if p_number is null or exists (select 1 from batch_po_numbers where n = p_number) then
    select greatest(coalesce(max(n), 4500), coalesce(p_number, 0)) + 1 into v_n from batch_po_numbers;
  else
    v_n := p_number;
  end if;
  insert into batch_po_numbers(n, claimed_by) values (v_n, left(coalesce(p_claimed_by,''), 120));
  return v_n;
end $$;

revoke all on function public.claim_batch_po_number(integer, text) from public;
revoke all on function public.claim_batch_po_number(integer, text) from anon;
grant execute on function public.claim_batch_po_number(integer, text) to authenticated, service_role;
