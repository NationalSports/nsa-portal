-- Team Shop orders (Stage 6, plan decision D1): Team Shop orders ARE
-- webstore_orders. One seeded 'nationalteamshop' webstores row is the store
-- every Team Shop order belongs to; the columns below are ADDITIVE ONLY, so
-- the existing storefront checkout, place_webstore_order (00171 — its
-- dynamic-key jsonb insert means new columns flow through with zero RPC
-- changes), stripe-webhook confirmation, refunds, and the OrderTrack portal
-- all keep working unchanged for both order sources.
--
-- Nothing here is required by existing code paths: pre-00195 the Team Shop
-- checkout function simply fails to find the store (or the new columns) and
-- returns an error — no storefront behavior changes either way.

-- ── webstore_orders: Team Shop identity ──────────────────────────────
-- order_source discriminates 'teamshop' rows from native storefront orders
-- (NULL = storefront, matching every existing row without a backfill).
-- coach_id / customer_id record WHO placed the order and FOR WHICH team —
-- coach_accounts.id is uuid, customers.id is text (same types as
-- teamshop_logos, 00194). quote_hash stores the v2 quote hash the coach
-- approved (quickorder-quote.js normalizeAndHash) for auditability.
alter table public.webstore_orders add column if not exists order_source text;
alter table public.webstore_orders add column if not exists coach_id uuid;
alter table public.webstore_orders add column if not exists customer_id text;
alter table public.webstore_orders add column if not exists quote_hash text;

-- ── webstore_order_items: decoration carry-through ───────────────────
-- decorations is the server-priced decoration spec array echoed from the
-- quote (type/pricing fields + placement identity + per-unit deco sell);
-- unit_deco_price is the summed per-unit decoration sell so money reports
-- can split garment (unit_price) from decoration without parsing jsonb.
alter table public.webstore_order_items add column if not exists decorations jsonb;
alter table public.webstore_order_items add column if not exists unit_deco_price numeric;

-- ── Seed the one Team Shop store row ─────────────────────────────────
-- The webstores table predates this repo's migration files (no CREATE TABLE
-- migration exists), so the slug UNIQUE constraint can't be referenced by
-- name here and `on conflict (slug)` would error if it were ever absent.
-- A WHERE NOT EXISTS guard is idempotent regardless of the constraint.
--
-- Field choices (verified against what webstore-checkout.js reads):
--   status 'open'         — placeOrder gates on store.status !== 'open'
--   payment_mode 'paid'   — allowPaid = payment_mode 'paid'|'either'; Team Shop
--                           is card-only (no team tab)
--   delivery_mode 'ship_home' — shipFee() charges flat_shipping and calcTax()
--                           sources tax to the coach's ship-to address
--   flat_shipping 0       — no shipping charge at launch (made-to-order,
--                           shipping policy TBD); the fee path stays exercised
--   processing_pct 0      — Team Shop adds no processing fee
--   fundraise_enabled false, number_unique false — storefront-only features
--   public_listed false, is_template false — never shown in the public store
--                           list (webstores_public / TeamStores) or BuildStore
--                           template picker
--   source 'teamshop'     — same discriminator convention as the OMG shadow
--                           stores (source 'omg', omg-packing-slip-ingest.js)
insert into public.webstores
  (slug, name, source, status, payment_mode, delivery_mode, flat_shipping,
   processing_pct, fundraise_enabled, number_unique, public_listed, is_template)
select
  'nationalteamshop', 'National Team Shop', 'teamshop', 'open', 'paid',
  'ship_home', 0, 0, false, false, false, false
where not exists (
  select 1 from public.webstores where slug = 'nationalteamshop'
);

-- ── Rollback ─────────────────────────────────────────────────────────
-- alter table public.webstore_orders drop column if exists order_source;
-- alter table public.webstore_orders drop column if exists coach_id;
-- alter table public.webstore_orders drop column if exists customer_id;
-- alter table public.webstore_orders drop column if exists quote_hash;
-- alter table public.webstore_order_items drop column if exists decorations;
-- alter table public.webstore_order_items drop column if exists unit_deco_price;
-- delete from public.webstores where slug = 'nationalteamshop'
--   and not exists (select 1 from public.webstore_orders o
--                   where o.store_id = webstores.id);
