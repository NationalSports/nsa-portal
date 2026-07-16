-- Idempotent purchase-order CREATION groundwork (creation only — NO supplier
-- submission in this pass; status never leaves 'draft'/'created').
--
-- Mirrors 00171 place_webstore_order (client_ref replay key) and REUSES the
-- 00161 batch PO-number allocator (claim_batch_po_number) so automatic and
-- manual POs share ONE number space — 00161 warns that two allocators over one
-- number space collide, so this deliberately does NOT mint its own.
--
-- MONEY IS INTEGER CENTS everywhere (totals_cents, unit_cost_cents: bigint).
--
-- Deferred on purpose: the so_item_po_lines mirror is NOT wired here. The plan
-- flagged that mirror needs its own concurrency test against the client save
-- engine (savSO / syncOrderItems race on so_items), which is out of scope for
-- this creation-only groundwork. TODO(phase-later): write the PO->so_item_po_lines
-- mirror in a separate migration WITH that concurrency test; until then these
-- tables stand alone and nothing reads them into the order book.

create table if not exists public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  client_ref       text not null unique,          -- retry/replay key (like webstore_orders.client_ref)
  po_number        text,                           -- shared NSA number from claim_batch_po_number
  vendor           text not null,
  supplier_account text,
  status           text not null default 'draft' check (status in ('draft','created','cancelled')),
  origin           text not null default 'auto',   -- 'auto' | 'manual'
  threshold_eval   jsonb,                          -- why the auto-PO fired (threshold snapshot)
  totals_cents     bigint,                         -- integer cents
  created_by       text,
  created_at       timestamptz default now(),
  submitted_at     timestamptz                     -- set only when a later pass submits to a supplier
);

create table if not exists public.purchase_order_lines (
  id              uuid primary key default gen_random_uuid(),
  po_id           uuid not null references public.purchase_orders(id) on delete cascade,
  so_id           text,
  so_item_id      text,
  product_id      text,
  sku             text,
  size            text,
  qty             int check (qty > 0),
  unit_cost_cents bigint,                          -- integer cents
  meta            jsonb
);
create index if not exists purchase_order_lines_po_id_idx on public.purchase_order_lines (po_id);

-- Staff SELECT; writes go through the service-role RPC only (or the service key
-- directly, which bypasses RLS). No write policy on purpose.
alter table public.purchase_orders enable row level security;
drop policy if exists purchase_orders_staff_read on public.purchase_orders;
create policy purchase_orders_staff_read on public.purchase_orders
  for select to authenticated using (public.is_team_member());
revoke select, insert, update, delete on public.purchase_orders from anon;

alter table public.purchase_order_lines enable row level security;
drop policy if exists purchase_order_lines_staff_read on public.purchase_order_lines;
create policy purchase_order_lines_staff_read on public.purchase_order_lines
  for select to authenticated using (public.is_team_member());
revoke select, insert, update, delete on public.purchase_order_lines from anon;

-- ── Idempotent creation RPC ─────────────────────────────────────────────────
create or replace function public.create_purchase_order(
  p_client_ref text,
  p_po         jsonb,
  p_lines      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po        purchase_orders;
  v_line      jsonb;
  v_num       integer;
  v_po_number text;
begin
  if coalesce(trim(p_client_ref), '') = '' then
    raise exception 'NSA_BAD_INPUT:client_ref required';
  end if;

  -- Retry-safe replay: an existing client_ref returns the existing header, no
  -- error, replayed:true (so a re-fired auto-PO or a double-submit is a no-op).
  select * into v_po from purchase_orders where client_ref = p_client_ref;
  if found then
    return jsonb_build_object('ok', true, 'replayed', true, 'purchase_order', to_jsonb(v_po));
  end if;

  -- Insert the header FIRST with no number, so a truly-concurrent same-client_ref
  -- race loses cleanly on the unique index WITHOUT having consumed a PO number
  -- (which would leave a gap in the shared NSA space). The winner mints below.
  begin
    insert into purchase_orders (
      client_ref, vendor, supplier_account, status, origin,
      threshold_eval, totals_cents, created_by
    ) values (
      p_client_ref,
      coalesce(nullif(p_po->>'vendor', ''), 'unknown'),
      nullif(p_po->>'supplier_account', ''),
      coalesce(nullif(p_po->>'status', ''), 'draft'),   -- check constraint enforces the enum
      coalesce(nullif(p_po->>'origin', ''), 'auto'),
      case when p_po ? 'threshold_eval' then p_po->'threshold_eval' else null end,
      case when nullif(p_po->>'totals_cents', '') is not null then (p_po->>'totals_cents')::bigint else null end,
      nullif(p_po->>'created_by', '')
    ) returning * into v_po;
  exception when unique_violation then
    select * into v_po from purchase_orders where client_ref = p_client_ref;
    return jsonb_build_object('ok', true, 'replayed', true, 'purchase_order', to_jsonb(v_po));
  end;

  -- Shared batch PO number: reuse the 00161 allocator (auto + manual share one
  -- space). A caller-supplied po_number is honored as-is.
  v_po_number := nullif(p_po->>'po_number', '');
  if v_po_number is null then
    v_num := public.claim_batch_po_number(null, coalesce(nullif(p_po->>'created_by', ''), 'po-rpc'));
    v_po_number := 'NSA ' || v_num;
  end if;
  update purchase_orders set po_number = v_po_number where id = v_po.id returning * into v_po;

  -- Lines (integer cents; qty > 0 enforced by the check constraint).
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into purchase_order_lines (
      po_id, so_id, so_item_id, product_id, sku, size, qty, unit_cost_cents, meta
    ) values (
      v_po.id,
      nullif(v_line->>'so_id', ''),
      nullif(v_line->>'so_item_id', ''),
      nullif(v_line->>'product_id', ''),
      nullif(v_line->>'sku', ''),
      nullif(v_line->>'size', ''),
      case when nullif(v_line->>'qty', '') is not null then (v_line->>'qty')::int else null end,
      case when nullif(v_line->>'unit_cost_cents', '') is not null then (v_line->>'unit_cost_cents')::bigint else null end,
      case when v_line ? 'meta' then v_line->'meta' else null end
    );
  end loop;

  return jsonb_build_object('ok', true, 'replayed', false, 'purchase_order', to_jsonb(v_po));
end $$;

-- Service-role only: auto-PO evaluator / staff endpoints call this with the
-- service key; nothing client-side may reach it.
revoke all on function public.create_purchase_order(text, jsonb, jsonb) from public;
revoke all on function public.create_purchase_order(text, jsonb, jsonb) from anon;
revoke all on function public.create_purchase_order(text, jsonb, jsonb) from authenticated;
grant execute on function public.create_purchase_order(text, jsonb, jsonb) to service_role;

-- ── Rollback ────────────────────────────────────────────────────────────────
--   drop function if exists public.create_purchase_order(text, jsonb, jsonb);
--   drop table if exists public.purchase_order_lines;
--   drop table if exists public.purchase_orders;
