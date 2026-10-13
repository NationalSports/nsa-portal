-- Bring two orders' refund totals in line with refunds already on record.
--
-- On 2026-09-25 two Crean Lutheran orders (#1011066 $69.90, #1011067 $77.80) were
-- refunded outside Stripe and logged directly into webstore_order_refunds
-- (kind 'offline'), but the orders themselves were never updated: refunded_amt
-- stayed 0 and the cancelled units stayed "awaiting refund". With the new
-- "Refund owed" flag (src/lib/webstoreOrderMoney.js refundOwed) that mismatch
-- would ask staff to refund those families a second time.
--
-- This moves no money. It copies the recorded offline refunds onto the order
-- (refunded_amt = sum of its refund ledger) and, where that now covers what was
-- taken off the order, marks the cancelled units as refunded. Limited to orders
-- whose ledger has offline rows and exceeds refunded_amt, so card refunds that
-- went through apply_webstore_refund are untouched.

with fix as (
  select o.id, round(sum(r.amount), 2) as ledger
    from public.webstore_orders o
    join public.webstore_order_refunds r on r.order_id = o.id
   group by o.id, o.refunded_amt
  having bool_or(r.kind = 'offline')
     and round(sum(r.amount), 2) > coalesce(o.refunded_amt, 0) + 0.005
)
update public.webstore_orders o
   set refunded_amt = fix.ledger
  from fix
 where o.id = fix.id;

update public.webstore_order_items i
   set refunded_qty = i.cancelled_qty
  from public.webstore_orders o
 where i.order_id = o.id
   and i.cancelled_qty > coalesce(i.refunded_qty, 0)
   and exists (select 1 from public.webstore_order_refunds r where r.order_id = o.id and r.kind = 'offline')
   and coalesce(o.refunded_amt, 0) + 0.005 >= coalesce(o.original_total, o.total) - o.total;
