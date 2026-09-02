-- Repair legacy direct-label orders created before synchronous shipment-ledger
-- recording. Only backfill orders with complete, mutually reinforcing evidence:
-- ShipStation shipment id + tracking + saved label + shipped timestamp, no
-- existing ledger row, and every active leaf line already fully shipped.
-- Mark the historical row emailed=true so this migration cannot send a second
-- shipment notification.

with candidates as (
  select
    o.id as order_id,
    o.store_id,
    o.tracking_number,
    o.carrier,
    o.shipped_at,
    o.label_cost,
    o.shipstation_shipment_id,
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'lineItemKey', i.id::text,
        'sku', i.sku,
        'name', i.name,
        'qty', i.qty,
        'image', i.image_url,
        'options', case when nullif(i.size, '') is null then '[]'::jsonb
          else jsonb_build_array(jsonb_build_object('name', 'Size', 'value', i.size)) end
      )) order by i.id
    ) as items
  from public.webstore_orders o
  join public.webstore_order_items i
    on i.order_id = o.id
   and not coalesce(i.is_bundle_parent, false)
   and i.line_status <> 'cancelled'
  where o.shipstation_shipment_id is not null
    and o.tracking_number is not null
    and o.label_data is not null
    and o.shipped_at is not null
    and not exists (
      select 1 from public.webstore_shipments s where s.order_id = o.id
    )
  group by o.id
  having count(*) > 0
     and bool_and(coalesce(i.shipped_qty, 0) >= coalesce(i.qty, 0))
), inserted as (
  insert into public.webstore_shipments (
    order_id, store_id, tracking_number, carrier, service, ship_date,
    items, emailed, created_at, cost, ss_shipment_id
  )
  select
    order_id, store_id, tracking_number, carrier, null, shipped_at::date,
    items, true, shipped_at, label_cost, shipstation_shipment_id
  from candidates
  on conflict (ss_shipment_id) do nothing
  returning order_id
)
-- The legacy order already carried full shipped_qty but not the line status,
-- which left the customer tracker displaying the pre-shipment production stage.
-- Scope this update strictly to ledger rows inserted above in this statement.
update public.webstore_order_items i
   set line_status = 'shipped'
  from inserted x
 where i.order_id = x.order_id
   and not coalesce(i.is_bundle_parent, false)
   and i.line_status <> 'cancelled'
   and coalesce(i.shipped_qty, 0) >= coalesce(i.qty, 0);
