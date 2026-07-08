-- Customer-facing order numbers for webstore orders.
--
-- Native webstore orders were identified only by their UUID (id) + secret
-- status_token — good for security, useless as a reference a buyer or support
-- rep can read over the phone. This adds a short, human-friendly running number.
--
-- A SEQUENCE (not a counter table) is the right tool: nextval never blocks and
-- never rolls back, so concurrent checkouts can't collide. Gaps (from a rolled-
-- back checkout) are fine for a reference number. It rides the existing insert
-- path untouched: place_webstore_order (00171) and the legacy insert both list
-- only the caller-provided columns, so this column's DEFAULT fires automatically
-- for every new order — no checkout code change needed. Existing orders keep a
-- NULL number (the storefront falls back to the id fragment for them), so nothing
-- historical is renumbered.
--
-- Start at 1,010,000 so the first customer number reads as an established shop.

create sequence if not exists webstore_order_number_seq as bigint start with 1010000;

alter table webstore_orders add column if not exists order_number bigint;
alter table webstore_orders alter column order_number set default nextval('webstore_order_number_seq');
alter sequence webstore_order_number_seq owned by webstore_orders.order_number;

-- Multiple NULLs are allowed (existing rows); new rows get a distinct value.
create unique index if not exists webstore_orders_order_number_key
  on webstore_orders (order_number);

-- The order insert runs as service_role (legacy checkout path) or as the definer
-- owner (place_webstore_order); grant sequence access so the DEFAULT can draw a
-- number under either. authenticated is included defensively for any staff-side
-- insert path — harmless, and avoids a "permission denied for sequence" surprise.
grant usage, select on sequence webstore_order_number_seq to service_role;
grant usage, select on sequence webstore_order_number_seq to authenticated;
