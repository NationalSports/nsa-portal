-- A staff item edit recomputes the portal order total but does not increase the
-- Stripe PaymentIntent. Prevent paid/pending-card orders from gaining units that
-- were never charged. Cancelled but not refunded units remain restorable because
-- the original payment still covers them.

create or replace function public.guard_paid_webstore_item_quantity_increase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.webstore_orders;
  v_paid_entitlement integer;
begin
  if coalesce(new.qty, 0) <= coalesce(old.qty, 0) then
    return new;
  end if;

  select * into v_order
    from public.webstore_orders
   where id = new.order_id;

  if not found then
    raise exception 'NSA_ORDER_NOT_FOUND' using errcode = '23503';
  end if;

  if v_order.stripe_pi_id is not null
     or lower(coalesce(v_order.payment_mode, '')) = 'paid'
     or lower(coalesce(v_order.status, '')) in ('pending_payment', 'paid', 'processing', 'shipped', 'complete', 'refunded') then
    v_paid_entitlement := greatest(
      coalesce(old.qty, 0) + coalesce(old.cancelled_qty, 0) - coalesce(old.refunded_qty, 0),
      0
    );
    if coalesce(new.qty, 0) > v_paid_entitlement then
      raise exception 'NSA_PAID_ORDER_QUANTITY_INCREASE: create a separate paid order for added units'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_paid_webstore_item_quantity_increase() from public, anon, authenticated;

drop trigger if exists trg_guard_paid_webstore_item_quantity_increase on public.webstore_order_items;
create trigger trg_guard_paid_webstore_item_quantity_increase
before update of qty on public.webstore_order_items
for each row
execute function public.guard_paid_webstore_item_quantity_increase();

comment on function public.guard_paid_webstore_item_quantity_increase() is
  'Blocks settled card orders from gaining uncharged units; permits restoration only up to purchased, unrefunded entitlement.';
