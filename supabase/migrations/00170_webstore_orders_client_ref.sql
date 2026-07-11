-- place_order idempotency token.
--
-- The storefront generates a client_ref (UUID) per checkout attempt and sends it
-- with place_order. A duplicate submit — double-click, network retry after a lost
-- response — matches the unique index below, and webstore-checkout returns the
-- EXISTING order (with its PaymentIntent's clientSecret for card orders) instead
-- of creating a second order + second PaymentIntent.
--
-- Nullable + partial index: orders placed by older clients (no ref) are untouched,
-- and webstore-checkout degrades gracefully if this migration hasn't been applied
-- yet (it detects the missing column and skips dedup).

alter table webstore_orders add column if not exists client_ref text;

create unique index if not exists webstore_orders_client_ref_key
  on webstore_orders (client_ref)
  where client_ref is not null;
