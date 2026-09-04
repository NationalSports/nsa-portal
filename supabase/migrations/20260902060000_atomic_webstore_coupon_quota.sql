-- A coupon was validated before order placement, then counted only after the
-- order/payment path completed. Two concurrent checkouts could therefore both
-- pass max_uses=1. Claim the quota under the coupon row lock in the same
-- transaction that creates the order, and key the claim to order_id so every
-- finalize/webhook retry is idempotent.

create table if not exists public.webstore_coupon_redemptions (
  order_id   uuid primary key references public.webstore_orders(id) on delete cascade,
  coupon_id  uuid references public.webstore_coupons(id) on delete set null,
  store_id   uuid not null,
  code       text not null,
  state      text not null check (state in ('reserved', 'redeemed', 'released')),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

create index if not exists idx_webstore_coupon_redemptions_coupon
  on public.webstore_coupon_redemptions (coupon_id, state);

alter table public.webstore_coupon_redemptions enable row level security;
revoke all on table public.webstore_coupon_redemptions from public, anon, authenticated;
grant select, insert, update, delete on table public.webstore_coupon_redemptions to service_role;

-- Existing confirmed/terminal orders may already be reflected in used_count,
-- so record them without changing the historical counter. Only a currently
-- pending card order needs a new live reservation during the migration.
with inserted as (
  insert into public.webstore_coupon_redemptions
    (order_id, coupon_id, store_id, code, state, redeemed_at)
  select o.id, c.id, o.store_id, o.coupon_code,
         case when lower(coalesce(o.status, '')) in ('pending', 'pending_payment')
              then 'reserved' else 'redeemed' end,
         case when lower(coalesce(o.status, '')) in ('pending', 'pending_payment')
              then null else coalesce(o.created_at, now()) end
    from public.webstore_orders o
    join public.webstore_coupons c
      on c.store_id = o.store_id and lower(c.code) = lower(o.coupon_code)
   where nullif(btrim(o.coupon_code), '') is not null
  on conflict (order_id) do nothing
  returning coupon_id, state
), pending as (
  select coupon_id, count(*)::int qty
    from inserted where state = 'reserved' group by coupon_id
)
update public.webstore_coupons c
   set used_count = coalesce(c.used_count, 0) + p.qty
  from pending p
 where c.id = p.coupon_id;

create or replace function public.release_webstore_coupon_reservation_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.state = 'reserved' then
    update public.webstore_coupons
       set used_count = greatest(coalesce(used_count, 0) - 1, 0)
     where id = old.coupon_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_release_webstore_coupon_reservation_on_delete
  on public.webstore_coupon_redemptions;
create trigger trg_release_webstore_coupon_reservation_on_delete
before delete on public.webstore_coupon_redemptions
for each row execute function public.release_webstore_coupon_reservation_on_delete();

create or replace function public.sync_webstore_coupon_redemption_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coupon_id uuid;
begin
  if lower(coalesce(new.status, '')) in ('paid', 'unpaid', 'batched') then
    update public.webstore_coupon_redemptions
       set state = 'redeemed', redeemed_at = coalesce(redeemed_at, now())
     where order_id = new.id and state = 'reserved';
  elsif lower(coalesce(new.status, '')) in
      ('cancelled', 'canceled', 'void', 'failed', 'archived') then
    update public.webstore_coupon_redemptions
       set state = 'released'
     where order_id = new.id and state = 'reserved'
    returning coupon_id into v_coupon_id;
    if v_coupon_id is not null then
      update public.webstore_coupons
         set used_count = greatest(coalesce(used_count, 0) - 1, 0)
       where id = v_coupon_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_webstore_coupon_redemption_state
  on public.webstore_orders;
create trigger trg_sync_webstore_coupon_redemption_state
after update of status on public.webstore_orders
for each row when (old.status is distinct from new.status)
execute function public.sync_webstore_coupon_redemption_state();

-- Post-payment callers use this instead of incrementing a counter directly.
-- New orders already have a row, while legacy orders are counted once here.
create or replace function public.redeem_webstore_coupon_for_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.webstore_orders;
  v_redemption public.webstore_coupon_redemptions;
  v_coupon public.webstore_coupons;
begin
  select * into v_order
    from public.webstore_orders
   where id = p_order_id
   for update;
  if not found then return false; end if;
  if nullif(btrim(v_order.coupon_code), '') is null then return true; end if;
  if lower(coalesce(v_order.status, '')) not in ('paid', 'unpaid', 'batched') then
    return false;
  end if;

  select * into v_redemption
    from public.webstore_coupon_redemptions
   where order_id = v_order.id
   for update;
  if found then
    if v_redemption.state = 'reserved' then
      update public.webstore_coupon_redemptions
         set state = 'redeemed', redeemed_at = coalesce(redeemed_at, now())
       where order_id = v_order.id;
    end if;
    return v_redemption.state <> 'released';
  end if;

  -- Legacy order placed before atomic reservations existed: honor the already
  -- accepted discount, but count it exactly once even if this RPC is retried.
  select * into v_coupon
    from public.webstore_coupons
   where store_id = v_order.store_id
     and lower(code) = lower(v_order.coupon_code)
   for update;
  if not found then return false; end if;

  update public.webstore_coupons
     set used_count = coalesce(used_count, 0) + 1
   where id = v_coupon.id;
  insert into public.webstore_coupon_redemptions
    (order_id, coupon_id, store_id, code, state, redeemed_at)
  values (v_order.id, v_coupon.id, v_order.store_id, v_order.coupon_code, 'redeemed', now())
  on conflict (order_id) do nothing;
  return true;
end;
$$;

revoke all on function public.redeem_webstore_coupon_for_order(uuid)
  from public, anon, authenticated;
grant execute on function public.redeem_webstore_coupon_for_order(uuid)
  to service_role;

revoke all on function public.release_webstore_coupon_reservation_on_delete()
  from public, anon, authenticated;
revoke all on function public.sync_webstore_coupon_redemption_state()
  from public, anon, authenticated;

-- Replace the current inventory-safe order transaction and add the coupon row
-- lock/claim immediately after the order insert. Any later stock/number error
-- rolls the order and coupon increment back together.
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
  v_coupon     public.webstore_coupons;
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

  if nullif(btrim(v_order.coupon_code), '') is not null then
    select * into v_coupon
      from public.webstore_coupons
     where store_id = v_order.store_id
       and lower(code) = lower(v_order.coupon_code)
     for update;
    if not found
       or not coalesce(v_coupon.active, false)
       or (v_coupon.expires_at is not null and v_coupon.expires_at < current_date) then
      raise exception 'NSA_COUPON_INVALID';
    end if;
    if v_coupon.max_uses is not null
       and coalesce(v_coupon.used_count, 0) >= v_coupon.max_uses then
      raise exception 'NSA_COUPON_USED';
    end if;

    update public.webstore_coupons
       set used_count = coalesce(used_count, 0) + 1
     where id = v_coupon.id;
    insert into public.webstore_coupon_redemptions
      (order_id, coupon_id, store_id, code, state, redeemed_at)
    values (
      v_order.id,
      v_coupon.id,
      v_order.store_id,
      v_order.coupon_code,
      case when lower(coalesce(v_order.status, '')) in ('pending', 'pending_payment')
           then 'reserved' else 'redeemed' end,
      case when lower(coalesce(v_order.status, '')) in ('pending', 'pending_payment')
           then null else now() end
    );
  end if;

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
    v_full_lifecycle := v_hold ? 'gross_max_avail';
    v_max := coalesce((v_hold->>'gross_max_avail')::int, (v_hold->>'max_avail')::int, 0);
    continue when v_qty <= 0;

    select wp.product_id into v_product_id
      from public.webstore_products wp
     where wp.id = (v_hold->>'webstore_product_id')::uuid
       and wp.store_id = v_order.store_id;
    if v_product_id is null then
      raise exception 'NSA_INVENTORY_UNVERIFIABLE:%', coalesce(v_hold->>'label', 'an item in your cart');
    end if;

    perform pg_advisory_xact_lock(hashtextextended(
      v_product_id || '|' || upper(btrim(coalesce(v_hold->>'size', ''))), 42));

    select coalesce(sum(h.qty), 0) into v_active
      from public.webstore_stock_holds h
      join public.webstore_products hp on hp.id = h.webstore_product_id
      join public.webstore_orders ho on ho.id = h.order_id
     where hp.product_id = v_product_id
       and upper(btrim(coalesce(h.size, ''))) = upper(btrim(coalesce(v_hold->>'size', '')))
       and h.expires_at > now()
       and (ho.id = v_order.id or lower(coalesce(ho.status, '')) in ('pending', 'pending_payment'));

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

revoke all on function public.place_webstore_order(jsonb, jsonb, jsonb, jsonb, int)
  from public, anon, authenticated;
grant execute on function public.place_webstore_order(jsonb, jsonb, jsonb, jsonb, int)
  to service_role;

comment on table public.webstore_coupon_redemptions is
  'Order-keyed, atomic coupon quota claims. Pending card attempts are reserved; accepted orders are redeemed; failed pending attempts are released.';

comment on function public.redeem_webstore_coupon_for_order(uuid) is
  'Idempotently finalizes an order coupon reservation or counts a legacy order exactly once. Service-role only.';
