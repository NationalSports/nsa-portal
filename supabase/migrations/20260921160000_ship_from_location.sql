-- Ship-from location on shipping labels.
--
-- Labels used to always print the company address (Glassell) as their origin,
-- even for parcels that leave the Emerson warehouse. Staff can now pick the
-- origin per label run; a store carries the default it usually ships from.
--
-- Codes come from src/lib/shipFrom.js (SHIP_FROM_LOCATIONS). NULL means "use the
-- default", so existing stores and orders keep today's behavior untouched. The
-- column is deliberately un-constrained text: retiring a location from the code
-- list must never make an old shipped order unreadable.

alter table public.webstores
  add column if not exists ship_from_code text;

comment on column public.webstores.ship_from_code is
  'Default ship-from location code for this store''s labels (src/lib/shipFrom.js). NULL = app default.';

alter table public.webstore_orders
  add column if not exists ship_from_code text;

comment on column public.webstore_orders.ship_from_code is
  'Ship-from location code the last label for this order was bought with. NULL = app default.';
