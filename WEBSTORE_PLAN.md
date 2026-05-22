# Club Webstore Integration — Implementation Plan

Branch: `claude/webstore-inventory-integration-F0OkC`

## Goal

Native, portal-hosted webstores per club that:

1. Show live inventory from the portal's `products` table.
2. Surface incoming stock with ETA when an item is out (from open PO lines).
3. Drop orders directly into `sales_orders` / `so_items` — no external import.
4. Support **two checkout modes per store**:
   - **Paid** — parents pay at checkout via Stripe.
   - **Unpaid (coach order)** — items go on a coach-owned order, charged to the team / invoiced later.
5. Optional **fundraising mode** — coach toggles a markup; the delta is tracked per order and rolled up per store as `fundraise_total`.
6. Sales orders are created from cart submissions either **manually** (rep clicks "Create SO from cart batch") or **automatically on a schedule** (nightly / weekly / on store close).

Today, OMG (OrderMyGear) does this externally and we ingest its reports via
`netlify/functions/omg-store-ingest.js` → `omg_stores` / `omg_store_products`.
The native flow replaces that for portal-managed stores; OMG ingest stays for legacy.

---

## Architecture (one paragraph)

A separate React storefront route (`/shop/:storeSlug`) lives in the same repo and
deploys to the same Netlify site, served on a wildcard subdomain
(`*.shop.nsasports.com`). It reads from Supabase through a **public anon role
+ RLS** scoped to `webstore_*` tables and a read-only `storefront_products`
view — never the raw back-office tables. Checkout, label, batching, and
fundraising payouts all run as Netlify functions reusing the existing
`stripe-payment`, `shipstation-proxy`, and Supabase service-role plumbing.

---

## Schema additions

New migration: `supabase_migration_011_webstores.sql`

```sql
-- One row per club webstore
CREATE TABLE webstores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,            -- URL: /shop/<slug>
  name            TEXT NOT NULL,
  customer_id     TEXT REFERENCES customers(id),   -- the club
  rep_id          TEXT REFERENCES team_members(id),
  coach_user_id   UUID REFERENCES user_profiles(id),

  status          TEXT NOT NULL DEFAULT 'draft',   -- draft|open|closed|archived
  open_at         TIMESTAMPTZ,
  close_at        TIMESTAMPTZ,

  -- Checkout behavior
  payment_mode    TEXT NOT NULL DEFAULT 'paid',    -- paid|unpaid|either
  require_login   BOOLEAN DEFAULT false,           -- public or club-members-only

  -- Order batching
  so_creation     TEXT NOT NULL DEFAULT 'manual',  -- manual|on_close|daily|weekly
  so_next_run_at  TIMESTAMPTZ,                     -- set by scheduler

  -- Fundraising
  fundraise_enabled BOOLEAN DEFAULT false,
  fundraise_pct     NUMERIC DEFAULT 0,             -- e.g. 0.15 → 15% markup
  fundraise_flat    NUMERIC DEFAULT 0,             -- or flat $ per item

  -- Branding
  logo_url        TEXT,
  primary_color   TEXT,
  hero_blurb      TEXT,

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Which SKUs are sold in which store (so each club can have its own catalog,
-- but inventory still resolves through the master products table)
CREATE TABLE webstore_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID NOT NULL REFERENCES webstores(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL,                     -- joins to products.sku
  display_name  TEXT,                              -- override of products.description
  retail_price  NUMERIC NOT NULL,                  -- store-level price (incl. fundraise markup baked in or applied at cart)
  decoration_id UUID,                              -- optional preset deco for this product in this store
  sort_order    INT DEFAULT 0,
  active        BOOLEAN DEFAULT true,
  UNIQUE (store_id, sku, decoration_id)
);
CREATE INDEX idx_webstore_products_store ON webstore_products(store_id);

-- Customer-facing orders. One row per checkout (whether paid or unpaid).
-- A nightly/manual job rolls multiple of these into a single sales_order.
CREATE TABLE webstore_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES webstores(id),
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|paid|unpaid|batched|cancelled|refunded
  payment_mode    TEXT NOT NULL,                   -- paid|unpaid (resolved at checkout)
  buyer_name      TEXT,
  buyer_email     TEXT,
  buyer_phone     TEXT,
  ship_address    JSONB,                           -- {name,street1,street2,city,state,zip,country}
  ship_method     TEXT,                            -- pickup|ship
  subtotal        NUMERIC NOT NULL,
  fundraise_amt   NUMERIC DEFAULT 0,               -- $ portion attributable to fundraise markup
  tax             NUMERIC DEFAULT 0,
  shipping        NUMERIC DEFAULT 0,
  total           NUMERIC NOT NULL,
  stripe_pi_id    TEXT,                            -- payment intent id, null when unpaid
  so_id           TEXT REFERENCES sales_orders(id),-- set when batched into an SO
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_webstore_orders_store_status ON webstore_orders(store_id, status);

CREATE TABLE webstore_order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES webstore_orders(id) ON DELETE CASCADE,
  sku             TEXT NOT NULL,
  size            TEXT,
  qty             INT NOT NULL,
  unit_price      NUMERIC NOT NULL,
  unit_fundraise  NUMERIC DEFAULT 0,               -- per-unit fundraise component
  decoration_id   UUID,
  player_name     TEXT,                            -- for personalized items
  player_number   TEXT,                            -- jersey number coach wants to see
  -- Per-line status, mirrored from the parent SO's job status so the coach
  -- and player both see live fulfillment state without exposing the full SO.
  line_status     TEXT DEFAULT 'pending',          -- pending|in_production|shipped|complete|cancelled
  backordered     BOOLEAN DEFAULT false
);
CREATE INDEX idx_webstore_order_items_order ON webstore_order_items(order_id);

-- Stable token emailed to each buyer so they can check status without a login.
-- One token per webstore_order; lives on the order row.
ALTER TABLE webstore_orders ADD COLUMN status_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16),'hex');

-- Read-only view the public storefront uses (no cost columns, no vendor info)
CREATE VIEW storefront_products AS
SELECT
  wp.store_id,
  wp.sku,
  COALESCE(wp.display_name, p.description) AS name,
  p.category,
  p.color,
  p.available_sizes,
  p.image_url,
  wp.retail_price,
  wp.decoration_id,
  wp.sort_order,
  -- stock snapshot: per-size stock JSON from products (existing column)
  p.size_stock,
  -- next-arrival ETA from open POs (see view below)
  pe.earliest_eta,
  pe.eta_qty
FROM webstore_products wp
JOIN products p ON p.sku = wp.sku
LEFT JOIN product_eta pe ON pe.sku = wp.sku
WHERE wp.active = true;

-- ETA helper: earliest open PO line per SKU
CREATE VIEW product_eta AS
SELECT
  pol.sku,
  MIN(po.expected_at) FILTER (WHERE po.status NOT IN ('received','cancelled')) AS earliest_eta,
  SUM(pol.qty) FILTER (WHERE po.status NOT IN ('received','cancelled'))         AS eta_qty
FROM po_lines pol
JOIN purchase_orders po ON po.id = pol.po_id
GROUP BY pol.sku;
```

**RLS policy summary:**

- `webstores`: public can `SELECT` rows where `status='open'`. Portal users (service role / authed staff) full access.
- `webstore_products` and `storefront_products` view: public `SELECT` only.
- `webstore_orders` / `webstore_order_items`: public can `INSERT` (checkout) and `SELECT` only their own row by id+email token. Portal staff full access.

> Note: column names like `po_lines.po_id`, `purchase_orders.expected_at`, and
> `products.size_stock` are placeholders — verify against the live schema during
> step 1 of the build and adjust the view definition. Today the AI Inventory PO
> Wizard already tracks "open POs"; we wire into whatever the actual columns are.

---

## Stock display logic (the "delayed → when it'll come in" piece)

For each (sku, size) tile:

```
on_hand        = products.size_stock[size]               (current stock)
open_po_qty    = sum of open PO line qty for that sku    (from product_eta)
earliest_eta   = MIN(expected_at) of those open POs

if on_hand >= 1                  → "In stock"
elif on_hand == 0 and open_po_qty
                                  → "Arriving ~<earliest_eta>" (still orderable, marked backorder)
else                              → "Sold out — notify me"  (email capture)
```

Backorder orders are accepted and flagged `backordered=true` on the
`webstore_order_items` row; they batch into the SO with a special line note so
fulfillment doesn't try to pick before the PO lands.

---

## Order → Sales Order batching

`netlify/functions/webstore-batch-so.js` (new):

- Input: `{ store_id, mode: 'manual' | 'scheduled' }`.
- Pulls all `webstore_orders` for that store with `status IN ('paid','unpaid')` and `so_id IS NULL`.
- Groups them into **one** `sales_orders` row (customer = the club), with `so_items` aggregated by (sku, size, decoration). Each underlying `webstore_order_items.player_name`/`player_number` becomes a pick-line note so personalization survives.
- Sets `webstore_orders.so_id` on each contributing order; sets `webstore_orders.status='batched'`.
- Writes `source='webstore'` and `webstore_id=<id>` columns on `sales_orders` (small additive migration to `sales_orders`).
- Returns SO id; rep then proceeds to the normal portal SO flow (decoration assignment, PO, ShipStation).

Scheduling: a Supabase scheduled edge function (`webstore-scheduler`) runs every
15 min, looks at `webstores.so_creation` and `so_next_run_at`, and invokes the
batch endpoint for stores whose window has hit. Manual mode just skips the
scheduler and exposes a "Batch now" button in the portal store-detail view.

---

## Payment flow

**Paid (parent checkout):**
1. Cart → `webstore-checkout` function creates a Stripe PaymentIntent (reuses `stripe-payment.js` plumbing).
2. Stripe webhook → flips `webstore_orders.status='paid'` and emails receipt via Brevo proxy.
3. Tax via existing `taxcloud-lookup` / `taxcloud-capture` edge functions.

**Unpaid (coach order):**
1. Cart → `webstore-checkout` writes the order with `payment_mode='unpaid'`, `status='unpaid'`.
2. No Stripe interaction. Confirmation email tells the coach the items will be added to the team's invoice.
3. Batches into the same SO as paid orders, but those line items are flagged for invoice rather than capture.

**Mixed store (`payment_mode='either'`):** parent picks at checkout; coach can also "place on team tab" if logged in as the store's coach.

---

## Fundraising

- Per-store toggle (`fundraise_enabled`) + either `fundraise_pct` or `fundraise_flat`.
- On add-to-cart, retail shown = `webstore_products.retail_price` (the markup is *already baked in* when the store was set up — simpler than runtime math, and matches how OMG works today).
- The `fundraise_amt` is computed at checkout as `retail_price - base_price` from `products.retail` reference, stored per line in `webstore_order_items.unit_fundraise` and summed onto `webstore_orders.fundraise_amt`.
- Store-detail page in the portal shows running `fundraise_total` (sum over the store's orders), matching the existing `omg_stores.fundraise_total` UX so coaches see one number.
- Payout to the club happens through the existing customer-credits flow (migration 005) — a "Disburse fundraising" button creates a credit memo for the club for the accumulated fundraise total.

---

## Portal UI additions

Two new screens (added to `src/App.js` nav, gated to staff):

1. **Webstores list** — table of all stores with status, sales, fundraise total, "Batch now" / "Open store" / "Close store" actions.
2. **Webstore detail** — three tabs:
   - **Catalog**: add/remove `webstore_products`, set price and decoration.
   - **Orders**: live list of `webstore_orders` with paid/unpaid filter, manual batch button.
   - **Settings**: payment_mode, so_creation, fundraise toggle, open/close dates, branding.

These reuse existing portal components (`OrderEditor`, product picker from `AiInventoryPoWizard`, decoration picker from `OrderEditor`).

---

## Coach order-tracking portal

The coach gets a **roster-style view of their store's orders** — not the
internal SO. This extends the existing `CoachPortal.js` (which already renders
SO/job statuses with the `prodLabelsP` labels and email open-tracking) rather
than building a new app.

New tab in `CoachPortal` — "Team Store" — visible when the logged-in coach is
the `coach_user_id` on one or more `webstores` (or the store's club is one of
the coach's `customers`):

- **Per-player order table**, one row per buyer (grouped from `webstore_orders`
  + `webstore_order_items` for that store):

  | Player / Buyer | Number | Items | Paid? | Status |
  |---|---|---|---|---|
  | Jordan M. (#12) | 12 | Jersey M, Hoodie L | Paid | In Production |
  | Casey R. (#7)   | 7  | Jersey S          | Unpaid (team tab) | In Line |

  - **Number** = `webstore_order_items.player_number`.
  - **Status** = `line_status`, kept in sync from the parent SO's job status
    (see sync note below). Shows the same friendly labels the coach already
    sees elsewhere (In Line / In Production / Shipped / Done).
  - **Paid?** = `payment_mode` + `status` (Paid via Stripe, or "Team tab" for
    unpaid coach orders).

- **Summary header**: total orders, total players ordered, # not yet ordered
  (if the coach uploaded a roster), fundraise running total.
- **Filters**: by status, paid/unpaid, by player.
- Coach actions are read-only on fulfillment (they can't change production
  status) but can: nudge a player who hasn't ordered (resend store link),
  export the roster as CSV, and — for unpaid stores — close the store / trigger
  the SO batch if `so_creation='manual'` and the store grants the coach that
  permission.

**Status sync (single source of truth):** the SO created by batching is the
real fulfillment record. A small reconciler (runs inside the existing SO
status-update path, or a Supabase trigger on `sales_orders` job changes) maps
the SO/job status back down to every `webstore_order_items.line_status` whose
`order.so_id` matches. So when staff move the SO to "In Production", every
linked player line — and thus the coach view and player portal — updates
automatically. No separate status entry.

## Player order-status portal

When a parent/player checks out, the confirmation email (Brevo, via existing
`brevo-proxy`) includes a **status link**:
`/shop/:slug/order/:id?t=<status_token>`.

- Public route, no login — the unguessable `status_token` authorizes read
  access to that one order (RLS: `SELECT` on `webstore_orders` /
  `webstore_order_items` allowed when the request's token matches).
- Shows: items ordered (with size, number, decoration), amount paid (or "on
  team tab"), and the live per-line `line_status` with the same step labels.
- A simple status timeline: Ordered → In Production → Shipped → Delivered,
  plus tracking number once ShipStation returns it (we already pull tracking
  via `ups-tracking` / ShipStation shipment data).
- For backordered lines, shows the ETA from `product_eta` ("Arriving ~Jun 12").
- "Notify me when it ships" is implicit — we email on each status change to the
  buyer_email on file (reuses the scheduled-email / Brevo plumbing).

Both portals read the **same** `line_status` field, so coach and player never
disagree, and neither can see cost/vendor data — only the storefront-safe
columns.

## Customer-facing storefront

New route tree under `src/storefront/` (lazy-loaded so it doesn't bloat the portal bundle):

- `/shop/:slug` — landing + product grid (uses `storefront_products` view)
- `/shop/:slug/p/:sku` — PDP with size grid showing stock state per size
- `/shop/:slug/cart` — cart
- `/shop/:slug/checkout` — Stripe Elements (paid) or contact form (unpaid)
- `/shop/:slug/order/:id?t=<status_token>` — player order-status portal (see above)

Subdomain routing: `*.shop.nsasports.com` rewrites in `netlify.toml` map subdomain → `slug` query param so each club can have its own URL while sharing one deploy.

---

## Build order (recommended)

1. **Schema + RLS** (migration 011). Validate column names against live DB during this step (`po_lines`, `products.size_stock`, etc.).
2. **Portal "Webstores" admin screens** (read-only first: list + detail showing catalog).
3. **Storefront product grid + PDP** reading the `storefront_products` view. No cart yet — just verify inventory + ETA display.
4. **Cart + unpaid checkout** end-to-end (simpler than paid, gets the data model exercised).
5. **Manual SO batching** — `webstore-batch-so` function + "Batch now" button.
6. **Player order-status portal** — `/shop/:slug/order/:id?t=` route + status email on checkout (Brevo).
7. **Status reconciler** — SO/job status → `webstore_order_items.line_status` (trigger or hook in existing SO update path).
8. **Coach "Team Store" tab** in `CoachPortal.js` — per-player roster table reading `line_status`.
9. **Stripe paid checkout** — reuse `stripe-payment.js`.
10. **Scheduled batching** — `webstore-scheduler` edge function.
11. **Fundraising** — pricing math + portal rollup + credit-memo disbursement.
12. **Backorder "notify me"** capture + email when stock lands (hook into existing PO-received flow).
13. **Status-change emails** to buyers + subdomain routing + theming.

Each step is independently shippable behind a feature flag on `webstores.status='draft'` — a store stays invisible to the public until staff flips it to `open`.

---

## Open questions to resolve before step 1

1. Do unpaid (coach) orders charge the team's existing customer record at SO time, or accumulate on a tab until the coach closes the store?
2. Should fundraising markup be visible to parents ("$5 of this purchase supports the team") or invisible?
3. Are catalogs club-specific (each store curates its own SKUs) or should we default-include the club's previously ordered products?
4. Pickup vs. ship per store, or always offer both?
