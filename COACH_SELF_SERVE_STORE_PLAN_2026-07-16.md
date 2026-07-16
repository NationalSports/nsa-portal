# Coach Self-Serve Store — Build Plan (2026-07-16)

**Goal:** give coaches, in their own portal, a **one-click build & publish** team store — with
**in-portal logo resize that drives production**, and item-adding via a **Live-Look-style product
search that shows in-stock items only.**

## Owner decisions (2026-07-16)

Both chosen deliberately by the owner; they reverse the codebase's default gates, so the guardrails
below exist to make the aggressive posture safe to run unattended.

1. **Publish gate → Build & publish LIVE.** A coach's one click puts the store live, no staff
   publish step.
2. **Logo resize → Drives production.** The coach's size/placement becomes the production
   decoration spec, not just a storefront preview.

## Guardrails (baked in — none add a staff step)

- **Server-side price lock** — reuse `coach-store-submit`'s existing rule: prices come from the
  server, tampered client prices ignored, fundraise clamped to cap. A coach can never publish
  mispriced/below-cost items.
- **Stock drop** — reuse the existing rule: anything not in stock *right now* (in-house OR vendor)
  is dropped at build time. Same resolver backs the product search's in-stock filter (one source
  of truth, no new stock logic).
- **Safe payment default** — coach-published-live stores get a safe `payment_mode` + explicit
  `processing_pct`, and honor `customers.disable_cc_pay`, until a store's first staff review. (The
  2026-07-02 money audit: live card checkout is barely tested and there's a hidden 5% fee setting.)
- **Logo quality gate** — validate the upload (min resolution, transparent/vector-friendly) *before*
  it drives production; low-quality is flagged for staff rather than sent to a decorator.
- **Order-time art check kept** — the per-order art approval stays as the final backstop before a
  decorator PO. It is not a publish gate, so it doesn't contradict "publish live." *Owner can remove
  this later for fully hands-off production — not assumed here.*

## What already exists (reuse — do not rebuild)

| Piece | Where | Reuse |
|---|---|---|
| Coach link-gated auth (alpha_tag match, service role) + pool + price-lock + stock-drop | `supabase/functions/coach-store-submit/index.ts` | The build engine — extend it, don't fork it. |
| Coach builder UI (`mode="coach"`) | `src/storefront/BuildStore.js` | Host the 1-click, product search, and resize UI here. |
| Placement/resize engine (per-style + per-item `x/y/w`, garment-type memory) | `src/lib/artGrid.js` (`resolveItemPlacement`, `garmentTypeOf`), storefront decoration render, `webstore_settings.placement_memory` | Coach resize writes the same `x/y/w`; production reads it. |
| Product search + in-stock resolver | Live Look catalog UI, `search_products` (excludes API vendors), vendor inventory tables, `storefront_all_vendor_stock` | The product-add search, filtered to allow-list + in-stock. |
| Payment/fee fields | `webstores.payment_mode`, `processing_pct`, `customers.disable_cc_pay` | The safe-payment default. |
| Template clone + publish + coach invite | `netlify/functions/store-quick-build.js`, `coach-invite.js` | Reference for the publish + invite path. |

## Build phases (file-level)

### Phase A — Coach 1-click build & publish live
- **`coach-store-submit/index.ts`**: add a `publish` path (status `open`, `open_at=now`,
  `created_via='coach'`) alongside branding inputs (`logo_url`, `primary_color`, `accent_color`,
  `sport`). Apply the **safe-payment default** when publishing. Keep every existing validation
  (identity/pool/price/stock). Emit the same staff alert (now "published", not "to review").
- **`BuildStore.js`** (coach mode): a **"Build & publish my store"** button that assembles the
  payload and calls the above; success → live store + shareable link (+ existing coach flow).
- Idempotency: one live store per (customer + sport) unless staff allow another.

### Phase B — Live-Look product search, in-stock only
- Drop the Live-Look product-search UI into the coach builder, scoped to the coach's **allow-list
  pool** and filtered by the **existing in-stock resolver** (per-size where the inventory has it).
- Out-of-stock items are hidden (not greyed) so a coach can't add something unfulfillable.

### Phase C — Logo resize on items (drives production)
- Coach-facing resize/reposition on each garment (reuse `resolveItemPlacement` + `x/y/w`); persist
  to `webstore_products.decorations`. This record **is** the production decoration spec carried onto
  orders (order-time art check remains the backstop).
- Add a **garment-type → default-placement seed map** feeding `resolveItemPlacement` (tee/jersey →
  full front, polo/¼-zip/hoodie/crew → left chest, shorts/pants → left leg, hat → front) so cold
  start is right per type instead of "left chest on everything." `garmentTypeOf` already classifies.
- **Logo quality gate** runs here before a size/placement can be saved as production intent.

## Data / schema touches (minimal)
- Reuse `webstores` branding + `webstore_products.decorations` as-is.
- Likely add: a `logo_quality` / `art_source='coach'` marker on the decoration or store, and a
  `published_by='coach'` provenance value so staff can spot coach-published-live stores for their
  first review. No new tables expected for v1.

## Risks explicitly accepted by the owner (recorded)
- Live card checkout on coach-published stores (mitigated by safe-payment default + first-review).
- Coach-set placement reaching production (mitigated by garment-type defaults, logo quality gate,
  and the retained order-time art check).

## Sequence
Phase A (1-click live) → Phase B (in-stock product search) → Phase C (resize + garment defaults +
quality gate). Each phase is shippable on its own.
