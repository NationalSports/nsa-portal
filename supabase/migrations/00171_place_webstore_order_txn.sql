-- Transactional place_order + 30-minute stock holds.
--
-- Replaces the app-level insert-then-compensate sequence in webstore-checkout
-- (order → items → number claims, with a manual three-delete "rollback" that a
-- crash mid-sequence defeats) with ONE stored procedure: everything commits or
-- nothing does. Also adds the first real inventory guard at checkout: a stock
-- HOLD is taken per (product, size) inside the same transaction, so two buyers
-- racing for the last item can no longer both pass the read-then-insert window.
--
-- Scope of the holds (deliberate): they protect the CHECKOUT WINDOW only —
-- a hold expires p_hold_minutes (default 30, per policy) after the order is
-- placed. After payment, demand accounting returns to today's semantics
-- (webstore demand is not subtracted from vendor stock); changing that is an
-- inventory-sync question, not a checkout one. Availability MATH (tall-size
-- folding, vendor stock, incoming/ETA backorder rules) stays in
-- webstore-checkout's checkStock — the single existing source of that logic —
-- which passes each line's max_avail in; the procedure owns only the
-- concurrency-critical part: hold accounting under a per-(product,size)
-- advisory lock.
--
-- Depends on 00170 (webstore_orders.client_ref): a duplicate client_ref aborts
-- the whole transaction via the unique index, and webstore-checkout replays the
-- existing order. webstore-checkout falls back to the legacy write path until
-- this migration is applied (missing-function detection), so deploy order
-- doesn't matter.

create table if not exists webstore_stock_holds (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null,
  webstore_product_id uuid not null,
  size                text,
  qty                 int not null check (qty > 0),
  order_id            uuid not null references webstore_orders(id) on delete cascade,
  expires_at          timestamptz not null,
  created_at          timestamptz default now()
);
create index if not exists idx_webstore_stock_holds_avail
  on webstore_stock_holds (webstore_product_id, size, expires_at);
create index if not exists idx_webstore_stock_holds_order
  on webstore_stock_holds (order_id);

-- Service-role only: no anon/authenticated policies on purpose.
alter table webstore_stock_holds enable row level security;

create or replace function place_webstore_order(
  p_order        jsonb,
  p_items        jsonb default '[]'::jsonb,
  p_claims       jsonb default '[]'::jsonb,
  p_holds        jsonb default '[]'::jsonb,
  p_hold_minutes int   default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  webstore_orders;
  v_cols   text;
  v_sel    text;
  v_item   jsonb;
  v_claim  jsonb;
  v_hold   jsonb;
  v_active int;
  v_qty    int;
  v_max    int;
begin
  -- ── Order ── insert only the keys the caller provided, so column DEFAULTs
  -- (id, status_token, created_at) still fire for everything absent.
  select string_agg(quote_ident(k), ','), string_agg(format('r.%I', k), ',')
    into v_cols, v_sel
    from jsonb_object_keys(p_order - 'id') as t(k);
  if v_cols is null then
    raise exception 'NSA_BAD_INPUT:empty order';
  end if;
  execute format(
    'insert into webstore_orders (%s) select %s from jsonb_populate_record(null::webstore_orders, $1) r returning *',
    v_cols, v_sel)
    into v_order
    using (p_order - 'id');

  -- ── Items ── same dynamic-key insert; order_id is injected here so the
  -- caller never has to know the order id before it exists.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_item := (v_item - 'id') || jsonb_build_object('order_id', v_order.id);
    select string_agg(quote_ident(k), ','), string_agg(format('r.%I', k), ',')
      into v_cols, v_sel
      from jsonb_object_keys(v_item) as t(k);
    execute format(
      'insert into webstore_order_items (%s) select %s from jsonb_populate_record(null::webstore_order_items, $1) r',
      v_cols, v_sel)
      using v_item;
  end loop;

  -- ── Jersey-number claims ── UNIQUE (store_id, player_number) is the real
  -- enforcement; a taken number aborts the WHOLE transaction (order, items,
  -- earlier claims, holds) — no compensation deletes, no orphans.
  for v_claim in select * from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    begin
      insert into webstore_number_claims (store_id, player_number, order_id, player_name)
      values (v_order.store_id, v_claim->>'player_number', v_order.id, v_claim->>'player_name');
    exception when unique_violation then
      raise exception 'NSA_NUMBER_TAKEN:%', v_claim->>'player_number';
    end;
  end loop;

  -- ── Stock holds ── caller passes max_avail (its availability math, from the
  -- same storefront view the shopper saw); this block serializes the check-and-
  -- reserve per (product, size) so concurrent checkouts can't both take the
  -- last unit. Expired holds stop counting on their own — no sweep required.
  for v_hold in select * from jsonb_array_elements(coalesce(p_holds, '[]'::jsonb)) loop
    v_qty := coalesce((v_hold->>'qty')::int, 0);
    v_max := coalesce((v_hold->>'max_avail')::int, 0);
    continue when v_qty <= 0;
    perform pg_advisory_xact_lock(hashtextextended(
      (v_hold->>'webstore_product_id') || '|' || coalesce(v_hold->>'size', ''), 42));
    select coalesce(sum(qty), 0) into v_active
      from webstore_stock_holds
      where webstore_product_id = (v_hold->>'webstore_product_id')::uuid
        and coalesce(size, '') = coalesce(v_hold->>'size', '')
        and expires_at > now();
    if v_active + v_qty > v_max then
      raise exception 'NSA_SOLD_OUT:%', coalesce(v_hold->>'label', 'an item in your cart');
    end if;
    insert into webstore_stock_holds (store_id, webstore_product_id, size, qty, order_id, expires_at)
    values (v_order.store_id, (v_hold->>'webstore_product_id')::uuid, v_hold->>'size', v_qty,
            v_order.id, now() + make_interval(mins => greatest(1, coalesce(p_hold_minutes, 30))));
  end loop;

  return jsonb_build_object('order', to_jsonb(v_order));
end $$;

-- Checkout runs with the service key; nothing else may call this.
revoke all on function place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) from public;
revoke all on function place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) from anon;
revoke all on function place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) from authenticated;
grant execute on function place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) to service_role;
