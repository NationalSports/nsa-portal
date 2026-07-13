# OMG Store Tracking Audit — 2026-07-11

**Question audited:** now that real OMG ingest stores are flowing, does parent-facing
tracking actually advance live through check-in/receiving → decoration → shipping, and
are all the connections working?

**Answer: No. For 11 of the 13 OMG stores in production, parents have seen zero
movement — 94% of all OMG order lines (557/592) are still at `pending` even though the
linked Sales Orders include one `complete`, one `in_production`, one `needs_pull`, and
one partially shipped.** Four independent breaks in the chain cause this, plus one
serious security regression found along the way. Everything below is verified against
the live production database (project `hpslkvngulqirmbstlfx`) unless labeled *inferred*.

---

## Production snapshot (queried 2026-07-11)

| Store | SO | SO status | Parent lines | Line statuses |
|---|---|---|---|---|
| Santiago Flag Football | SO-1111 | waiting_receive | 17 | in_production |
| Los Altos Football | SO-1149 | waiting_receive, **partial shipped** | 114 | pending |
| Clovis HS Football | SO-1165 | need_order | 100 | pending |
| SJM Baseball | SO-1234 | waiting_receive | 18 | received (1 order shipped w/ tracking) |
| Dana Hills Football | SO-1239 | **in_production** | 12 | pending |
| Inglewood HS Football | SO-1240 | waiting_receive | 12 | pending |
| Reedley HS Volleyball | SO-1250 | waiting_receive | 24 | pending |
| Servite Football | SO-1295 | **needs_pull** | 120 | pending |
| Mountain House HS FB | SO-1366 | **complete** | 86 | pending |
| Alemany Volleyball | SO-1392 | waiting_receive | 41 | pending |
| Orange Lutheran XC | SO-1465 | waiting_receive | 28 | pending |
| Mountain House HS FB #2 | SO-1475 | waiting_receive | 18 | pending |

The worst case is Mountain House SO-1366: the SO is **complete** and all 22 parents
still see "on order." Dana Hills is in production; Servite's goods are in the building
awaiting pull; Los Altos has partially shipped — all with parents stuck at pending.

Parent-facing status lives on `webstore_order_items.line_status`
(pending/on_order → received → in_production → bagging → shipped), rolled up per order
by `orderStatus()` (`src/OmgOrderPortal.js:1073`). Two mechanisms are supposed to
advance it; both are broken for OMG, and the third leg (shipping) is broken for
everything.

---

## Break #1 — the SKU|SIZE match that drives per-item advancement fails for 76% of lines **[VERIFIED]**

The only fine-grained advancement path for OMG is client-side:
`savSO()` → `pushOmgStatusSync()` (`src/App.js:134-147`) →
`_applyWebstoreStageSync()` (`src/App.js:116-132`), which matches each parent line to
the SO's receiving data by the string key `UPPER(sku)|UPPER(size)`. Unmatched lines are
held back (treated as not-received) forever, silently.

Measured match rate against live data — **143 of 592 lines (24%) can ever match**:

| Store | Lines | Empty SKU | Keys matching SO |
|---|---|---|---|
| Clovis | 100 | **100** | 0 |
| Los Altos | 114 | 0 | **0** (SKUs present but entirely different strings) |
| Mountain House (both) | 104 | **104** | 0 |
| Orange Lutheran | 28 | **28** | 0 |
| Santiago | 17 | **17** | 0 |
| SJM | 18 | **18** | 0 |
| Dana Hills | 12 | 5 | 2 |
| Inglewood | 12 | 6 | 6 |
| Alemany | 41 | 0 | 4 |
| Reedley | 24 | 0 | 23 |
| Servite | 120 | 0 | 108 |

Two causes:
- **Empty SKUs from ingest** (7 stores, 100% of their lines): the player-report ingest
  extracts SKU by regex from the OMG color string, e.g. `"Black/White (KB9093)"`
  (`netlify/functions/omg-player-report-ingest.js`, item build around lines 176-192).
  When the color carries no `(SKU)` suffix the line gets no SKU, producing keys like
  `|2XL` that can never match.
- **Size-vocabulary drift**: lines carry `MEN'S 2XL`, `MENS MEDIUM`, `MENS LARGE`;
  SO sizes are `2XL`, `MENS S`, `M`. Uppercasing doesn't reconcile these.

There is no error, no flag, no UI distinction between "genuinely backordered" and
"key will never match."

## Break #2 — the stage map no-ops during the entire receiving window **[VERIFIED in code; explains the stores whose keys DO match]**

`computeOmgSoSync` (`src/App.js:80-102`) maps the computed SO status to a store stage:
`ready_to_invoice/complete → bagging`, `in_production → in_production`,
`items_received → received`, **everything else → null → the push returns without
writing anything** (`src/App.js:138`).

But `calcSOStatus` (`src/components.js:361-441`) returns `items_received` only when
**every** unit on the SO is pulled/received (`fulfilledSz >= totalSz`), and returns
`waiting_receive` or `needs_pull` throughout the real receiving/pull window. So:

- Partial receiving advances **nobody** — the guide's promise ("Receive blanks →
  parents auto-advance to Received. Backordered SKU+sizes stay at On order") is
  unreachable: the per-SKU backorder allocation in `_applyWebstoreStageSync` only runs
  once the whole SO is received, at which point there are no backorders left to hold.
- `needs_pull` (goods physically in, awaiting pull — Servite's current state, 108/120
  keys matching) maps to null and advances nothing. Note the DB trigger (migration 037)
  maps `needs_pull` to `in_production` — the two implementations disagree.

10 of the 12 live SOs currently sit in exactly these unmapped statuses.

## Break #3 — the DB-trigger backstop is disconnected for 9 of 12 SOs **[outcome VERIFIED; mechanism inferred]**

The server-side safety net (`webstore_sync_status()`, migration 037) bails immediately
when `sales_orders.webstore_id` is null. Live data: **9 of 12 OMG SOs have
`webstore_id = null`** — including complete SO-1366 and in-production SO-1239. Only
SO-1111, SO-1240, SO-1475 are linked; Santiago's `in_production` lines are the trigger
working (it advances coarsely, ignoring SKUs — which is why it succeeded where the
client push couldn't).

Mechanism *(inferred, high confidence)*: `createOmgSO` (`src/App.js:14668-14674`) sets
`webstore_id` in a fire-and-forget block right after generating the SO id. The
companion update in the same block (`webstore_orders.so_id`) succeeded for **all** 12
stores, and all sale codes match — so the lookup was fine; the difference is the
target: the `sales_orders` row very likely didn't exist in Supabase yet when
`.update().eq('id', generatedId)` ran (the SO persists asynchronously), producing a
0-rows-affected "success." No error is thrown for a 0-row update and the catch only
`console.warn`s. Recommend re-running the linkage on SO load or via a backfill.

## Break #4 — the ShipStation webhook has never fired, for any store type **[VERIFIED]**

`webstore_shipments` is **empty system-wide** while 81 orders (80 native webstore +
1 OMG) carry tracking numbers and `shipped_at` since 2026-06-15. Those fields came
from the optimistic client-side label path (`src/OmgOrderPortal.js:601-605` /
`src/Webstores.js:10959`). The webhook (`netlify/functions/shipstation-webhook.js`) is
the component that:
- advances `line_status` to `shipped` authoritatively,
- writes `webstore_shipments`,
- **sends the parent the Brevo "shipped + tracking" email** (`sendShipEmail`, :179).

None of that has ever happened. The one shipped OMG order (SJM #186008587, shipped
6/17, tracking present) has lines stuck at `received` and `confirmation_sent=false` —
its parent was never emailed tracking. This is a ShipStation-side configuration issue
(webhook not registered or pointing at the wrong URL) — not diagnosable from the repo;
needs an ops check in the ShipStation dashboard.

---

## Parents mostly never got the link at all

The tracking link (`/shop/order/<status_token>`) reaches parents via the **manual**
"Send processing emails" step. Live data: only 2 of 13 stores ever sent it
(Mountain House 22/22, SJM 7/7). Four stores (Clovis, Servite, Los Altos, Alemany —
92 orders) have **no buyer emails at all** (packing slip never ingested), so their
parents are unreachable and unaware a tracking page exists. Even a fixed status
pipeline is invisible until this step is worked.

Related *(inferred, high confidence — needs a live send test)*: the shipped email's
"View your full order" link and the native confirmation email both build
`/shop/<slug>/order/<id>` unconditionally (`shipstation-webhook.js:198`,
`_webstoreEmail.js:45`). OMG shadow stores are `status='archived'` by design, and the
storefront rejects archived stores (`src/storefront/Storefront.js:333`) — an OMG
parent clicking that link gets "We couldn't find that store." Only the token link
(`OrderTrack.js`) works for OMG.

## "Live" for parents = fetch-on-load

`OrderTrack.js` fetches once on mount (`:66-82`); no realtime subscription, no
polling. Same for `OrderStatusPage` in `Storefront.js`. Reloading shows fresh data, so
this is acceptable — but nothing updates while the page is open. Also: the order-ID
page (`Storefront.js:1848-2132`) never renders the tracking number/carrier; only the
token page does.

---

## Security finding (found during RLS verification) — **HIGH, act promptly**

`webstore_orders`, `webstore_order_items`, `webstore_roster`, and `webstores` all
carry live anon policies `FOR SELECT TO anon USING (true)` (migration 070, applied to
production — verified via `pg_policies`). Anyone holding the public anon key (it ships
in every browser bundle) can dump **every parent's name, email, phone, full home
address, order total, Stripe PI id — and every order's `status_token`**, across all
stores, in one REST call. The token exposure defeats the bearer-token model of the
tracking page and lets an attacker post as any customer in the order message thread.
This re-opens the exact hole `supabase/migrations/00134_webstore_rls_lockdown.sql`
previously closed; migration 070 reopened it to un-break the coach portal. Fix by
scoping what CoachStore needs behind a security-definer view/RPC (the
`webstores_public` pattern already in 00134) instead of table-wide anon reads.
The parent tracking pages themselves don't need these policies at all — they read
through the service-role Netlify function.

---

## What IS working

- Ingest: shadow webstores, parent orders, line items, and strong random
  `status_token`s are created correctly and idempotently; `webstore_orders.so_id`
  linked for all 12 SO-created stores.
- The token tracking page renders all five stages, partial-shipment, backorder
  flags, and tracking links correctly; the nsa-website `/shop/*` iframe proxy passes
  token URLs through intact.
- Processing-email flow works where staff ran it; manual per-order/"Move all"
  overrides work (SJM's `received` state is almost certainly a manual move —
  *inferred*).
- Deliver-to-school gating (labels hidden, `deliver_school`) wired correctly.

## Recommended fix order

1. **ShipStation webhook registration** (ops, no code) — restores shipped status +
   tracking emails for native webstores too.
2. **RLS lockdown** of the four anon-readable tables (small migration; scope the coach
   portal via view/RPC).
3. **Backfill + harden `sales_orders.webstore_id`** (backfill from
   `webstores.omg_sale_code`; set it on SO load if missing) — instantly revives the
   coarse DB trigger for all OMG stores, SKU-independent.
4. **Stage-map fix**: map `needs_pull`/partial receiving in `computeOmgSoSync` (align
   with migration 037's mapping) so parents see "Received"/"In production" during the
   real fulfillment window.
5. **SKU reconciliation**: fix empty-SKU extraction in the ingest, normalize size
   vocabulary, and surface unmatched lines in the OMG portal instead of silently
   holding them.
6. Send the missing packing slips / processing emails for the 11 stores whose parents
   have no link (staff task once 3-5 land).

*Audit performed read-only: no code, data, or schema was changed.*
