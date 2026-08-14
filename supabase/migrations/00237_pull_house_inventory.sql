-- Atomic house-inventory decrement for warehouse pulls (00237).
--
-- THE BUG THIS CLOSES: pulling an IF decrements product_inventory through the
-- client's diff-save (App.js prod watcher → _dbSaveProduct), which re-uploads
-- the WHOLE size→qty map as an absolute value from the tab's possibly-stale
-- local state. Two staff pulling the same product concurrently (two tabs, desk
-- + mobile) each compute "local - mine"; whichever absolute upsert lands last
-- silently overwrites the other's decrement — a classic lost update, on the
-- same shape 00206 fixed for webstore_transfers.
--
-- THE FIX: the pull paths call this RPC with the pulled DELTAS. Each row is
-- decremented against the LIVE row (greatest(quantity - qty, 0) — clamped,
-- never negative), in deterministic (product_id, size) order so two
-- overlapping pulls can't deadlock. Returns the post-decrement quantities so
-- the client can adopt server truth into local state. A (product, size) with
-- no inventory row is returned found:false and skipped — pulling an untracked
-- product must not fail the pull (parity with 00206's zero-row posture).
--
-- The client's diff-save write path for spreadsheet imports and manual stock
-- edits is handled by 00239 (merge_product_inventory): edits are applied as
-- baseline-relative deltas on the live row, so a stale tab's save composes
-- with concurrent pulls instead of overwriting them.
--
-- Each pull row may carry the so_id it was pulled FOR. When it does, the RPC
-- also closes that SO's matching open backorder needs (teamshop_auto_po_needs
-- qty_needed, oldest row first) by the pulled amount: pulled garments are a
-- SATISFIED backorder, so the row leaves the Backorders queue and — critically
-- — its claim stops counting against the checkout cap, whose supply side
-- (on-hand) also just dropped by the same units. Without this, a pulled-but-
-- not-yet-completed SO double-subtracts from the sellable pool. Best-effort:
-- the needs table may predate 00202, and stocked orders have no needs rows.
--
-- Guard: same shape as 00206 pull_webstore_transfers — staff (is_team_member)
-- or service_role; a coach JWT is rejected.

create or replace function public.pull_house_inventory(
  p_pulls jsonb  -- [{product_id text, size text, qty int, so_id text|null}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role      text;
  v_pull      record;
  v_qty       int;
  v_rows      jsonb := '[]'::jsonb;
  v_found     boolean;
  v_has_needs boolean;
  v_need      record;
  v_remaining int;
  v_dec       int;
begin
  v_has_needs := to_regclass('public.teamshop_auto_po_needs') is not null;
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;

  if p_pulls is null or jsonb_typeof(p_pulls) <> 'array' then
    raise exception 'NSA_BAD_INPUT:p_pulls array required';
  end if;

  -- Deterministic lock order (product_id, size) prevents deadlocks between two
  -- concurrent pulls touching the same products in different orders.
  for v_pull in
    select x.product_id, x.size, x.qty, x.so_id
      from jsonb_to_recordset(p_pulls) as x(product_id text, size text, qty int, so_id text)
     where coalesce(x.product_id, '') <> ''
       and coalesce(x.size, '') <> ''
       and coalesce(x.qty, 0) > 0
     order by x.product_id, x.size
  loop
    update product_inventory
       set quantity = greatest(coalesce(quantity, 0) - v_pull.qty, 0)
     where product_id = v_pull.product_id and size = v_pull.size
     returning quantity into v_qty;
    v_found := found;
    v_rows := v_rows || jsonb_build_object(
      'product_id', v_pull.product_id,
      'size', v_pull.size,
      'quantity', coalesce(v_qty, 0),
      'found', v_found);

    -- Close this SO's matching open backorder needs by the pulled amount
    -- (oldest need row first when an SO has several for the same key).
    if v_has_needs and coalesce(v_pull.so_id, '') <> '' then
      v_remaining := v_pull.qty;
      for v_need in
        select id, qty_needed from teamshop_auto_po_needs
         where so_id = v_pull.so_id and product_id = v_pull.product_id
           and size = v_pull.size and qty_needed > 0
         order by created_at, id
      loop
        exit when v_remaining <= 0;
        v_dec := least(v_need.qty_needed, v_remaining);
        update teamshop_auto_po_needs
           set qty_needed = qty_needed - v_dec
         where id = v_need.id;
        v_remaining := v_remaining - v_dec;
      end loop;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end $$;

revoke all on function public.pull_house_inventory(jsonb) from public;
revoke all on function public.pull_house_inventory(jsonb) from anon;
grant execute on function public.pull_house_inventory(jsonb) to authenticated;
grant execute on function public.pull_house_inventory(jsonb) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.pull_house_inventory(jsonb);
