-- Add deco_pos column to sales_orders for SO-level outside-decoration PO tracking.
-- A decoration PO is not a line-item purchase — it's a cost bucket that ties a decorator's
-- bill (and commission) to the sales order. Stored as JSONB array of records:
--   {id, po_id, vendor, deco_vendor_id, deco_type, item_idxs, qty, unit_cost, notes,
--    drop_ship, expected_date, preexisting, status, created_at,
--    _bill_cost, _bill_details, tracking_numbers}
alter table public.sales_orders
  add column if not exists deco_pos jsonb not null default '[]'::jsonb;
