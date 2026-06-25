-- Add deco_pos column to estimates so digitizing/vector (Topstar) POs can be planned during the
-- estimate phase, before a sales order exists. Mirrors the column on sales_orders (migration 00061).
-- On convertSO the estimate's deco_pos array is deep-cloned onto the new sales order, so the digitizing
-- cost (and its matching customer-charge line item) carry forward. Same JSONB record shape as the
-- sales_orders column:
--   {id, po_id, vendor, deco_vendor_id, deco_type, topstar_service, item_idxs, qty, unit_cost,
--    expected_cost, notes, images, status, created_at, _bill_cost, _bill_details, tracking_numbers}
-- A "planned" status means the PO is captured for costing but has NOT been emailed to the vendor yet;
-- the rep sends it explicitly (or after the estimate converts) from the PO's full-page view.
alter table public.estimates
  add column if not exists deco_pos jsonb not null default '[]'::jsonb;
