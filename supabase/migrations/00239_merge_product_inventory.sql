-- Baseline-relative house-inventory saves (00239) — closes the last absolute-
-- write overwrite window that 00237 documented as residual risk.
--
-- THE BUG THIS CLOSES: _dbSaveProduct uploaded product_inventory as ABSOLUTE
-- size→qty values from the tab's local state. 00237 moved warehouse pulls to
-- a server-side decrement, but a catalog edit / spreadsheet import saved from
-- another tab could still overwrite a concurrent pull with its stale absolute
-- numbers (window = time since that tab last synced, up to ~10 min).
--
-- THE FIX: the client now sends, per (size), the new quantity AND the BASE
-- quantity its edit started from (the diff-save snapshot — the last state the
-- tab loaded or saved). The server applies the client's intended DELTA on the
-- LIVE row:  new = greatest(live + (quantity - base), 0). A pull that landed
-- between the tab's sync and its save survives, because the edit is applied
-- as "+10 from what I saw", not "the value is 50". Deltas chain and commute:
-- overlapping saves from the same tab (the diff-save baseline advances per
-- pass) and pulls from other tabs compose to the right total in any order.
--
-- base IS NULL means "no baseline known" (brand-new product, or a restore/
-- seed) → absolute set, the legacy semantics. alert_threshold stays absolute
-- (nothing else writes it concurrently). Rows are processed in size order for
-- a deterministic lock order (same posture as 00237); sizes not in p_rows are
-- left untouched (parity with the upsert this replaces — it never deleted).
--
-- Guard: staff (is_team_member) or service_role, exactly as 00237.

create or replace function public.merge_product_inventory(
  p_product_id text,
  p_rows jsonb  -- [{size text, quantity int, base int|null, alert_threshold int|null}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row  record;
  v_qty  int;
  v_out  jsonb := '[]'::jsonb;
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' and not public.is_team_member() then
    raise exception 'NSA_FORBIDDEN:staff or service role required';
  end if;
  if coalesce(p_product_id, '') = '' then
    raise exception 'NSA_BAD_INPUT:p_product_id required';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'NSA_BAD_INPUT:p_rows array required';
  end if;

  for v_row in
    select x.size, x.quantity, x.base, x.alert_threshold
      from jsonb_to_recordset(p_rows) as x(size text, quantity int, base int, alert_threshold int)
     where coalesce(x.size, '') <> ''
     order by x.size
  loop
    insert into product_inventory (product_id, size, quantity, alert_threshold)
    values (p_product_id, v_row.size, greatest(coalesce(v_row.quantity, 0), 0), v_row.alert_threshold)
    on conflict (product_id, size) do update set
      quantity = case
        when v_row.base is null then greatest(coalesce(v_row.quantity, 0), 0)
        else greatest(coalesce(product_inventory.quantity, 0) + (coalesce(v_row.quantity, 0) - coalesce(v_row.base, 0)), 0)
      end,
      alert_threshold = excluded.alert_threshold
    returning quantity into v_qty;
    v_out := v_out || jsonb_build_object('size', v_row.size, 'quantity', v_qty);
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_out);
end $$;

revoke all on function public.merge_product_inventory(text, jsonb) from public;
revoke all on function public.merge_product_inventory(text, jsonb) from anon;
grant execute on function public.merge_product_inventory(text, jsonb) to authenticated;
grant execute on function public.merge_product_inventory(text, jsonb) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.merge_product_inventory(text, jsonb);
