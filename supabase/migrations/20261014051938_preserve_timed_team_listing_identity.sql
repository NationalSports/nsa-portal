-- Timed team-store orders are batched after checkout. Preserve the exact listing
-- and its purchase-time decorations so two cards backed by one blank product do
-- not collapse into one production line. Nullable keeps every historical row and
-- the immediate Club / All School conversion paths backward-compatible.
alter table public.webstore_order_items
  -- Intentionally no FK: this is immutable purchase identity and must survive
  -- later catalog-row deletion so the order still batches as the bought listing.
  add column if not exists webstore_product_id uuid,
  add column if not exists decoration_snapshot jsonb;

create index if not exists webstore_order_items_webstore_product_id_idx
  on public.webstore_order_items(webstore_product_id)
  where webstore_product_id is not null;

comment on column public.webstore_order_items.webstore_product_id is
  'Exact timed team-store listing purchased; null for legacy, Club, All School, OMG, and bundle rows.';
comment on column public.webstore_order_items.decoration_snapshot is
  'Immutable timed team-store treatment (decorations, personalization, transfers, size SKU map) at checkout; null means use the legacy catalog fallback.';
