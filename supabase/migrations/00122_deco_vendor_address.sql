-- Add a ship-to address to outside-decoration vendors.
-- When an item's blanks are drop-shipped to an outside decorator, the blank PO's Ship To
-- should default to the decorator's address instead of NSA's warehouse / the customer.
-- Stored as a single free-text block (street, city, state zip) edited in Settings → Deco Vendors.
alter table public.deco_vendors
  add column if not exists address text;
