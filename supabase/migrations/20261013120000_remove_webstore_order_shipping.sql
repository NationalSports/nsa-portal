-- Refund a webstore order's shipping charge.
--
-- Refunds move money through the existing refund flow (stripe-payment.js →
-- apply_webstore_refund). What this adds is the order-side half, done the same
-- way an item cancellation is: the shipping charge comes off the order
-- (shipping_fee → 0, total lowered by the same amount), and the difference is
-- then owed back and refunded through the normal review-and-send step.
--
-- Keeping the order's own numbers in step matters: "Refund owed" on the order
-- list is computed as charged − current total − refunded (src/lib/
-- webstoreOrderMoney.js refundOwed). A shipping refund recorded only as money
-- out, with the total untouched, would make a later item cancellation look
-- under-owed by the shipping amount.
--
-- Tax is left alone: order tax is carried against merchandise (the item-edit RPC
-- scales it by subtotal only), so shipping carries no tax to return.

create or replace function public.remove_webstore_order_shipping(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_order public.webstore_orders;
  v_ship numeric;
  v_total numeric;
begin
  if not public.is_team_member() then
    raise exception 'NSA_NOT_STAFF' using errcode = '42501';
  end if;

  if auth.uid() is not null then
    select tm.id into v_actor
      from public.team_members tm
     where tm.auth_id = auth.uid() and coalesce(tm.is_active, true)
     limit 1;
  end if;

  select * into v_order
    from public.webstore_orders
   where id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_ship := round(coalesce(v_order.shipping_fee, 0), 2);
  if v_ship <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_shipping_charge');
  end if;
  -- Never take off more than is still refundable on the charge.
  if round(coalesce(v_order.original_total, v_order.total, 0) - coalesce(v_order.refunded_amt, 0), 2) < v_ship then
    return jsonb_build_object('ok', false, 'error', 'exceeds_refundable');
  end if;

  v_total := round(greatest(0, coalesce(v_order.total, 0) - v_ship), 2);

  update public.webstore_orders
     set shipping_fee = 0,
         total = v_total
   where id = p_order_id;

  insert into public.webstore_order_item_changes
    (order_id, order_item_id, actor_team_member_id, change_kind, before_data, after_data)
  values
    (p_order_id, null, v_actor, 'shipping_removed',
     jsonb_build_object('shipping_fee', v_ship, 'total', v_order.total),
     jsonb_build_object('shipping_fee', 0, 'total', v_total));

  return jsonb_build_object('ok', true, 'owed', v_ship, 'total', v_total);
end;
$$;

revoke all on function public.remove_webstore_order_shipping(uuid) from public, anon;
grant execute on function public.remove_webstore_order_shipping(uuid) to authenticated;
