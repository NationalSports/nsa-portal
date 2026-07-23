-- Transactional transfer pull (Team Shop backend hardening #5).
--
-- Webstores.js pullBatchTransfers (~1679-1688) currently does a client
-- read-then-write: computePullPlan (~642-648) computes each transfer's target
-- on_hand from the CLIENT's in-memory `detail.transfers` snapshot, then the
-- component writes those absolute values back one row at a time, followed by
-- a separate stamp of webstore_orders.transfers_pulled. Two staff pulling
-- overlapping batches concurrently (or one staff double-clicking, or a stale
-- tab) can race: both read the same stale on_hand, both compute the same
-- "new" value, and the second write silently loses the first pull's
-- decrement — on_hand ends up too HIGH, which is the wrong direction for
-- inventory staff rely on to avoid overselling committed stock.
--
-- This RPC replaces the client compute-then-write with a single-transaction,
-- DB-side decrement: `on_hand = greatest(on_hand - qty, 0)` runs against the
-- LIVE row at UPDATE time (no snapshot, no lost-update window), for every
-- {code, qty} need, then stamps every affected order in the same transaction.
-- Either the whole pull commits or none of it does (a mid-batch failure never
-- leaves some transfers decremented and others not, or transfers decremented
-- with no orders stamped).
--
-- Auth: security definer, mirroring advance_job_stage's (00192) internal
-- guard — same is_team_member() predicate 00194/00198's RLS policies gate
-- Team Shop staff tables on, embedded directly in the function body (rather
-- than only in an RLS policy) because this RPC also needs to be callable by
-- the service role with no team_members row of its own. Granted to both
-- authenticated and service_role; a signed-in coach (authenticated but no
-- team_members row) is rejected inside the function, same as
-- advance_job_stage.
--
-- Return shape: {ok, decremented, stamped} — counts, not full rows (callers
-- already hold the transfer id list client-side for the optimistic UI).
--
-- Rollback:
--   drop function if exists public.pull_webstore_transfers(uuid, text[], jsonb);
--
-- Verification: applied to a scratch local Postgres 16 instance this session
-- against a minimal webstore_transfers/webstore_orders stand-in and exercised:
--   (1) a normal pull with two needed codes decremented exactly the qty
--       requested (logo-a 50->38 for qty 12, 3|8in|white 10->8 for qty 2 —
--       matches webstorePullBatchTransfers.test.js's existing computePullPlan
--       fixture numbers) and stamped both so_ids' transfers_pulled.
--   (2) qty exceeding on_hand clamps to 0, never negative.
--   (3) a code with no matching row is a zero-row update, not an error — the
--       order(s) still get stamped.
--   (4) null p_store_id / empty p_so_ids raise NSA_BAD_INPUT.
--   (5) the no-lost-update claim: two sequential calls decrementing the SAME
--       code by 5 each (simulating two staff sessions / a double pull)
--       accumulated correctly, 38 -> 33 -> 28 — each UPDATE reads the LIVE
--       row, so there is no snapshot window in which a second writer can
--       overwrite the first writer's decrement (the exact failure mode of
--       the old client read-then-write loop, which computed an absolute
--       on_hand from a point-in-time snapshot and could lose a concurrent
--       decrement instead of accumulating both).
-- NOT run against the repo's full Supabase schema — only this function's own
-- table dependencies. Re-run on a full scratch Supabase DB before this ships.

create or replace function public.pull_webstore_transfers(
  p_store_id uuid,
  p_so_ids   text[],
  p_needs    jsonb  -- [{code, qty}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       text;
  v_need       record;
  v_row_count  int;
  v_decremented int := 0;
  v_stamped     int := 0;
begin
  -- Same guard shape as advance_job_stage (00192): staff phone (is_team_member)
  -- OR a service-role caller (a future server-side batch/sweep). A coach JWT
  -- (authenticated, no team_members row) is rejected.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;

  if p_store_id is null then
    raise exception 'NSA_BAD_INPUT:p_store_id required';
  end if;
  if p_so_ids is null or array_length(p_so_ids, 1) is null then
    raise exception 'NSA_BAD_INPUT:p_so_ids required';
  end if;

  -- One atomic decrement per need, against the LIVE row — no client-computed
  -- absolute value, no read-then-write window. A code with no matching row
  -- for this store is simply a zero-row update (not an error): the client's
  -- neededByCode can reference a code that was removed/renamed since the
  -- page loaded, and a pull must not fail the whole batch over it.
  for v_need in
    select * from jsonb_to_recordset(coalesce(p_needs, '[]'::jsonb)) as x(code text, qty numeric)
  loop
    if v_need.code is null or coalesce(v_need.qty, 0) <= 0 then
      continue;
    end if;
    update webstore_transfers
       set on_hand = greatest(on_hand - v_need.qty, 0)
     where store_id = p_store_id and code = v_need.code;
    get diagnostics v_row_count = row_count;
    v_decremented := v_decremented + v_row_count;
  end loop;

  update webstore_orders
     set transfers_pulled = true, transfers_pulled_at = now()
   where store_id = p_store_id and so_id = any(p_so_ids);
  get diagnostics v_stamped = row_count;

  return jsonb_build_object('ok', true, 'decremented', v_decremented, 'stamped', v_stamped);
end $$;

revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from public;
revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from anon;
grant execute on function public.pull_webstore_transfers(uuid, text[], jsonb) to authenticated, service_role;
