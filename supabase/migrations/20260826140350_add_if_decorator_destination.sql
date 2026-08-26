
-- Persist the exact decorator PO selected on an Item Fulfillment request. The warehouse uses
-- these fields to resolve the decorator address and put the DPO reference on ShipStation's
-- attention line; memo remains reserved for human warehouse notes.
alter table public.so_item_pick_lines
  add column if not exists deco_po_id text,
  add column if not exists deco_vendor_id text,
  add column if not exists attention text;