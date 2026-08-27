-- Refunded units are final. Without this guard, a cancelled/refunded line could
-- later be restored to active qty, putting it back on reports without charging
-- the buyer again. Lock fully-refunded orders as immutable item history and cap
-- partially-refunded lines at their remaining non-refunded units.
create or replace function public.guard_refunded_webstore_item_restore()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_fully_refunded boolean;
  v_max_active integer;
begin
  if new.size is not distinct from old.size
     and new.qty is not distinct from old.qty
     and new.line_status is not distinct from old.line_status then
    return new;
  end if;

  select coalesce(o.refunded_amt, 0) > 0
         and coalesce(o.refunded_amt, 0) >= coalesce(o.original_total, o.total, 0) - 0.01
    into v_fully_refunded
    from public.webstore_orders o
   where o.id = old.order_id;

  if coalesce(v_fully_refunded, false) then
    raise exception 'NSA_ORDER_FULLY_REFUNDED' using errcode = 'P0001';
  end if;

  if coalesce(old.refunded_qty, 0) > 0 then
    v_max_active := greatest(0,
      coalesce(old.qty, 0) + coalesce(old.cancelled_qty, 0) - coalesce(old.refunded_qty, 0)
    );
    if coalesce(new.qty, 0) > v_max_active then
      raise exception 'NSA_ITEM_QTY_ALREADY_REFUNDED' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_refunded_webstore_item_restore on public.webstore_order_items;
create trigger trg_guard_refunded_webstore_item_restore
before update of size, qty, line_status on public.webstore_order_items
for each row execute function public.guard_refunded_webstore_item_restore();

revoke all on function public.guard_refunded_webstore_item_restore()
  from public, anon, authenticated;
