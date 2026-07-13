-- Audit fixes (build audit) for pull_webstore_transfers (00206):
--   * HIGH  — not idempotent: a double-pull of the same batch (double-click, two
--             staff, a stale tab) decremented on_hand a SECOND time, because the
--             decrement ran unconditionally and the stamp was a plain idempotent
--             re-write. Net: committed stock silently understated.
--   * MEDIUM — the `greatest(on_hand - qty, 0)` clamp silently destroyed the
--             shortfall: an oversell (need 60, on_hand 40) clamped to 0, the UI
--             reported success, and production discovered the gap days later at
--             the press with no record anywhere.
--
-- FIX 1 (idempotency): claim the orders FIRST, in one atomic UPDATE gated on
-- `transfers_pulled IS NOT TRUE`. If that claims ZERO rows, every requested order
-- was already pulled — return a no-op WITHOUT decrementing. Only a run that
-- actually claims at least one fresh order proceeds to decrement. The whole
-- function is one transaction, so a claim + decrement either both commit or both
-- roll back. This closes the exact double-pull the finding describes (same batch
-- pulled twice → the second call claims nothing → no second decrement).
--
--   Residual (documented, not fixed here — out of scope): if two DIFFERENT
--   batches that SHARE one order are pulled concurrently, the second still
--   decrements its full passed-in needs even though one order was already
--   claimed by the first. Correctly handling that requires the RPC to recompute
--   needs from the newly-claimed orders' line items server-side (today needs are
--   passed in by the client). Whole-batch pulls — the actual workflow — are now
--   safe; partial-overlap concurrent pulls of distinct batches remain a rare,
--   pre-existing edge and are called out so a future pass can close them.
--
-- FIX 2 (shortfall visibility): each decrement now captures the pre-update
-- on_hand under a row lock (SELECT … FOR UPDATE, so the value that feeds the
-- shortfall check is the same one the decrement acts on — no race) and, when the
-- need exceeds stock, records {code, needed, on_hand, short} into a `shortfalls`
-- array returned to the caller. Stock is still clamped at 0 (never negative), but
-- the oversell is now surfaced instead of erased. Callers that ignore the field
-- behave exactly as before; the field lets the UI flag a real shortage.
--
-- Return shape (superset of 00206 — additive, existing callers unaffected):
--   { ok, decremented, stamped, already_pulled, shortfalls: [{code,needed,on_hand,short}] }
--
-- Auth / signature / grants unchanged from 00206 (same 3-arg signature; CREATE OR
-- REPLACE preserves privileges; re-granted below to be explicit).
--
-- Rollback: re-apply the pull_webstore_transfers block from 00206_pull_transfers_txn.sql.

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
  v_role        text;
  v_need        record;
  v_row_count   int;
  v_old_oh      numeric;
  v_decremented int := 0;
  v_stamped     int := 0;
  v_shortfalls  jsonb := '[]'::jsonb;
begin
  -- Same guard shape as advance_job_stage (00192): staff phone (is_team_member)
  -- OR a service-role caller. A coach JWT (authenticated, no team_members row) is
  -- rejected.
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

  -- FIX 1 — claim first. Stamp only orders not already pulled; the row count is
  -- the number of FRESH claims. This is the idempotency gate.
  update webstore_orders
     set transfers_pulled = true, transfers_pulled_at = now()
   where store_id = p_store_id
     and so_id = any(p_so_ids)
     and transfers_pulled is not true;
  get diagnostics v_stamped = row_count;

  -- Nothing fresh to pull → the batch was already pulled. Do NOT decrement again.
  if v_stamped = 0 then
    return jsonb_build_object('ok', true, 'decremented', 0, 'stamped', 0,
                              'already_pulled', true, 'shortfalls', '[]'::jsonb);
  end if;

  -- One atomic decrement per need against the LIVE row. FOR UPDATE locks the
  -- matching rows so the pre-update on_hand we read for the shortfall check is the
  -- exact value the decrement acts on (no read-then-write window). A code with no
  -- matching row is a zero-row update (not an error) — the client's need list can
  -- reference a code removed/renamed since the page loaded.
  for v_need in
    select * from jsonb_to_recordset(coalesce(p_needs, '[]'::jsonb)) as x(code text, qty numeric)
  loop
    if v_need.code is null or coalesce(v_need.qty, 0) <= 0 then
      continue;
    end if;

    -- Lock the matching rows first, THEN read their summed on_hand — FOR UPDATE
    -- can't ride on an aggregate select, so the lock is a separate PERFORM. Both
    -- run in this one transaction, so the value read for the shortfall check is
    -- the value the decrement then acts on (no read-then-write window).
    perform 1 from webstore_transfers
     where store_id = p_store_id and code = v_need.code for update;
    select coalesce(sum(on_hand), 0) into v_old_oh
      from webstore_transfers
     where store_id = p_store_id and code = v_need.code;

    update webstore_transfers
       set on_hand = greatest(on_hand - v_need.qty, 0)
     where store_id = p_store_id and code = v_need.code;
    get diagnostics v_row_count = row_count;
    v_decremented := v_decremented + v_row_count;

    -- FIX 2 — surface the oversell instead of swallowing it. Only when a matching
    -- row exists (row_count > 0) and stock was short of the need.
    if v_row_count > 0 and v_old_oh < v_need.qty then
      v_shortfalls := v_shortfalls || jsonb_build_object(
        'code', v_need.code, 'needed', v_need.qty,
        'on_hand', v_old_oh, 'short', v_need.qty - v_old_oh);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'decremented', v_decremented,
                            'stamped', v_stamped, 'already_pulled', false,
                            'shortfalls', v_shortfalls);
end $$;

revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from public;
revoke all on function public.pull_webstore_transfers(uuid, text[], jsonb) from anon;
grant execute on function public.pull_webstore_transfers(uuid, text[], jsonb) to authenticated, service_role;
