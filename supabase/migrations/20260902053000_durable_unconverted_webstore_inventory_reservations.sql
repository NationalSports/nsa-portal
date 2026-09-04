-- Checkout holds originally protected only the first 30 minutes. Paid and
-- team-tab orders can wait days for store close, so later shoppers could buy the
-- same physical/incoming units after the hold expired. Keep the short hold for
-- pending checkout attempts, then derive the durable reservation from live
-- accepted order items through unfinished sales-order production. SO conversion
-- does not decrement warehouse stock and auto-PO generation is asynchronous, so
-- releasing at conversion would create another oversell window.
--
-- Resource identity is products.id + size, not webstore_products.id + size:
-- the same warehouse/vendor inventory can be offered by multiple stores.

create index if not exists idx_webstore_order_items_inventory_resource
  on public.webstore_order_items (product_id, upper(btrim(size)), order_id)
  where product_id is not null and qty > 0;

create or replace function public.place_webstore_order(
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
  v_order      public.webstore_orders;
  v_cols       text;
  v_sel        text;
  v_item       jsonb;
  v_claim      jsonb;
  v_hold       jsonb;
  v_product_id text;
  v_active     int;
  v_reserved   int;
  v_qty        int;
  v_max        int;
  v_full_lifecycle boolean;
begin
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

  for v_claim in select * from jsonb_array_elements(coalesce(p_claims, '[]'::jsonb)) loop
    begin
      insert into public.webstore_number_claims (store_id, player_number, order_id, player_name)
      values (v_order.store_id, v_claim->>'player_number', v_order.id, v_claim->>'player_name');
    exception when unique_violation then
      raise exception 'NSA_NUMBER_TAKEN:%', v_claim->>'player_number';
    end;
  end loop;

  for v_hold in select * from jsonb_array_elements(coalesce(p_holds, '[]'::jsonb)) loop
    v_qty := coalesce((v_hold->>'qty')::int, 0);
    -- Compatibility in both deploy directions:
    -- * old checkout sends max_avail already net of converted SO shortage;
    --   keep counting only unconverted accepted demand.
    -- * new checkout also sends gross_max_avail; count full live demand here,
    --   including converted-but-unfinished SOs, without double-subtracting.
    v_full_lifecycle := v_hold ? 'gross_max_avail';
    v_max := coalesce((v_hold->>'gross_max_avail')::int, (v_hold->>'max_avail')::int, 0);
    continue when v_qty <= 0;

    -- Resolve and validate the shared inventory resource server-side. A caller
    -- cannot point a hold at a product listing from another store.
    select wp.product_id into v_product_id
      from public.webstore_products wp
     where wp.id = (v_hold->>'webstore_product_id')::uuid
       and wp.store_id = v_order.store_id;
    if v_product_id is null then
      raise exception 'NSA_INVENTORY_UNVERIFIABLE:%', coalesce(v_hold->>'label', 'an item in your cart');
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      v_product_id || '|' || upper(btrim(coalesce(v_hold->>'size', ''))), 42));

    -- Pending attempts count through their short hold. For this transaction,
    -- include holds already inserted by an earlier cart line even when the new
    -- order is an immediately accepted team-tab order.
    select coalesce(sum(h.qty), 0) into v_active
      from public.webstore_stock_holds h
      join public.webstore_products hp on hp.id = h.webstore_product_id
      join public.webstore_orders ho on ho.id = h.order_id
     where hp.product_id = v_product_id
       and upper(btrim(coalesce(h.size, ''))) = upper(btrim(coalesce(v_hold->>'size', '')))
       and h.expires_at > now()
       and (ho.id = v_order.id or lower(coalesce(ho.status, '')) in ('pending', 'pending_payment'));

    -- Once accepted, the order item's live qty/size is the reservation. This
    -- naturally follows staff reductions, size edits, cancellations and
    -- refunds. New callers keep the reservation through unfinished SO
    -- production; legacy callers retain the old net-of-claims input contract.
    -- All stores share the same products.id inventory resource.
    select coalesce(sum(greatest(coalesce(i.qty, 0), 0)), 0) into v_reserved
      from public.webstore_order_items i
      join public.webstore_orders o on o.id = i.order_id
      left join public.sales_orders so on so.id = o.so_id
     where i.product_id = v_product_id
       and upper(btrim(coalesce(i.size, ''))) = upper(btrim(coalesce(v_hold->>'size', '')))
       and o.id <> v_order.id
       and (
         (not v_full_lifecycle
          and o.so_id is null
          and lower(coalesce(o.status, '')) in ('paid', 'unpaid'))
         or
         (v_full_lifecycle
          and lower(coalesce(o.status, '')) in ('paid', 'unpaid', 'batched')
          and (o.so_id is null or lower(coalesce(so.status, '')) not in
            ('complete', 'completed', 'done', 'cancelled', 'void', 'archived')))
       )
       and i.qty > 0
       and lower(coalesce(i.line_status, '')) not in ('cancelled', 'canceled')
       -- A store can deliberately opt a made-to-order listing out of stock
       -- tracking. Do not let those orders consume a shared tracked pool in a
       -- different store merely because both listings reference one catalog
       -- product. This predicate mirrors checkout's tracked-item rule.
       and exists (
         select 1
           from public.webstore_products iwp
           join public.products ip on ip.id = i.product_id
          where iwp.store_id = o.store_id
            and iwp.product_id = i.product_id
            and coalesce(iwp.track_inventory, true)
            and nullif(ip.inventory_source, '') is not null
            and ip.inventory_source <> 'manual'
       );

    if v_active + v_reserved + v_qty > v_max then
      raise exception 'NSA_SOLD_OUT:%', coalesce(v_hold->>'label', 'an item in your cart');
    end if;

    insert into public.webstore_stock_holds
      (store_id, webstore_product_id, size, qty, order_id, expires_at)
    values
      (v_order.store_id, (v_hold->>'webstore_product_id')::uuid, v_hold->>'size', v_qty,
       v_order.id, now() + make_interval(mins => greatest(1, coalesce(p_hold_minutes, 30))));
  end loop;

  return jsonb_build_object('order', to_jsonb(v_order));
end;
$$;

revoke all on function public.place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) from public, anon, authenticated;
grant execute on function public.place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) to service_role;

comment on function public.place_webstore_order(jsonb, jsonb, jsonb, jsonb, int) is
  'Atomically creates a webstore order and prevents oversell using pending checkout holds plus accepted order-item reservations through unfinished SO production, shared across stores.';
