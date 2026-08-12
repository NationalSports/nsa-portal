# Bagging Station — Spec & Build Plan

Tablet-based, one-order-at-a-time bagging for webstore fulfillment. A packer opens a
batch, the station serves orders one at a time, each line item is tapped off as it goes
in the bag, and a 4×6 bag label prints automatically when the last item is checked.
Shortages are flagged inline and gate the club shipment until resolved.

Decisions locked with Scott (2026-08-12):

- **v1 scope**: batch stores with deliver-to-club (`webstores.org_type='team'`,
  `delivery_mode='deliver_club'`) **plus OMG deliver-to-school stores** (same
  tap-and-bag flow, no per-order shipping label — see "OMG store tie-in" below).
  At-once ship-home orders (teamshop / club stores / ship_home webstores / ship_home
  OMG) are Phase 2.
- **Check-off**: tap, big touch targets. Barcode scan-to-verify is Phase 2.
- **Printing**: 4×6 thermal printer at the station; label prints automatically on
  order completion ("full auto").
- **Shortages**: flag & bag partial. Shorted orders land on a **Resolve list** that
  must be cleared (found / pulled from elsewhere / accepted short) before the store's
  club shipment can be created.
- **Concurrency**: build for 2+ packers from day one — opening an order claims it.
- **Batch complete**: prompt the club shipment right on the tablet.

## Why this is cheap: what already exists

| Piece | Where |
|---|---|
| Customer-visible `bagging` stage | `webstore_order_items.line_status` ('pending→received→in_production→bagging→shipped→complete'), today set only by triggers (`supabase/migrations/00213_line_status_from_jobs.sql`) |
| Per-bag grain | `webstore_order_items`: `size`, `qty`, `player_name`, `player_number`, `variant_label`, bundle grouping (`bundle_ref`, `is_bundle_parent`), `shipped_qty`, `missing_qty`, `backorder_eta` |
| Batch model | `batchOrders` / `BatchesTab` in `src/Webstores.js` — many `webstore_orders` → one `sales_orders` row via `so_id` |
| Tablet kiosk precedent | `/floor-station` (`src/floorstation/FloorStation.js` + pure `floorLogic.js` + `src/__tests__/floorStation.test.js`), routed in `src/index.js` via `src/lib/hostRouting.js`, station auth via sign-in or `?token=` |
| 4×6 label printing | `printQrLabel` / `barcodeSvg` in `src/utils.js`; box labels in `src/boxTracking.js`; per-order packing slips `buildPackingLists` (`src/Webstores.js:153`) |
| Shipment plumbing | `webstore_shipments`, box tracking (`supabase/migrations/00185_box_tracking.sql`), ShipStation via `netlify/functions/shipstation-proxy.js` (Phase 2) |

## OMG store tie-in

OMG sales already ride the same rails, so the station serves them with a widened
queue — but four specifics matter (mapped 2026-08-12 from `src/OmgOrderPortal.js`,
`netlify/functions/omg-packing-slip-ingest.js`, `netlify/functions/_shared.js`,
`supabase_migration_034_omg_order_tracking.sql`):

1. **Shadow-webstore model.** Each OMG sale is a `webstores` row with `source='omg'`
   + `omg_sale_code` (status 'archived', so it never shows publicly), and each parent
   order from the packing-slip ingest is a normal `webstore_orders` row with
   `omg_order_number` + `webstore_order_items` lines (sku/size/qty/player fields —
   the same per-bag grain). So the station's claim/check/short/complete RPCs work on
   OMG orders **unchanged**.
2. **Different batch key and delivery-mode column.** Native batches group by
   `webstore_orders.so_id`; OMG shadow orders typically have `so_id` null and are
   found via `webstores.source='omg'` + `omg_sale_code` (the SO carries
   `omg_store_id`, see `src/App.js:235`). And the delivery mode lives on
   `omg_stores.delivery_mode` ('ship_home'|'deliver_school'), not
   `webstores.delivery_mode`. → The plan generalizes to a **bag group**:
   `so_id` for native batches, `store_id` (shadow webstore) for OMG sales. Queue
   predicate, `bag_seq`, and `bagging_batch_progress` are all keyed on the bag group,
   and the BatchPicker unions native `deliver_club` batches with OMG
   `deliver_school` stores.
3. **Ingest must not clobber bagging progress.** Re-importing a packing slip is
   normal and idempotent: `syncOrderItems` (`netlify/functions/_shared.js:338`)
   merges lines by `(sku, size)`, updates only `ITEM_CONTENT_KEYS`
   (name/color/qty/unit_price/player_name/image_url), deliberately preserves
   `line_status`/`shipped_qty`/`missing_qty`, and deletes leftover rows only when
   they have no fulfillment progress. Two required changes ride along with the
   migration: (a) the new `bagged_qty`/`short_*` columns must join the preserved
   set (they're not content keys, so updates already skip them — add a regression
   test proving it), and (b) the leftover-delete guard at `_shared.js:383-391` must
   also treat `bagged_qty > 0` or an open short as "has progress" so a re-parse
   can't delete a line that's physically in a bag.
4. **The station coexists with the auto-stage sync, it doesn't fight it.**
   `pushOmgStatusSync` (`src/App.js:229-242`) advances `line_status` to 'bagging'
   the moment production jobs finish — before anyone has bagged anything. That's
   fine under this plan's rule that bagging RPCs never write `line_status`:
   `line_status='bagging'` keeps meaning "ready to bag / being bagged" and
   `bagged_at` records the actual human act. Similarly the OMG portal's manual
   "Move all" / per-order stage buttons keep working; the station adds truth
   underneath rather than a competing writer.

Two OMG-specific payoffs come free:

- **Deliver-to-school today just stops after packing lists** — label UI is
  suppressed and there is no shipment/box record at all (`src/OmgOrderPortal.js:839`,
  `:913`). The station's batch-complete → shipment prompt (box tracking) fills that
  exact gap: the school delivery finally gets a contents record.
- **OMG "ready to bag" is per-line automatic**: `_applyWebstoreStageSync`
  (`src/App.js:195-227`) holds un-received SKU|sizes at `on_order` while received
  ones advance, so the station's order screen can gray out not-yet-arrived lines
  ("on order — 2 more expected") instead of forcing an immediate short. "Can't find
  it" stays for the genuinely-missing case; an `on_order` line is a *wait*, not a
  short. An order with `on_order` lines can still be partially bagged and revisited
  (the QR on the label reopens it).

Ship gate mapping for OMG: the gate blocks `printOmgLabels` (ship_home) and the
"Move all → Shipped" bulk action (deliver_school) while the sale has open shorts —
same rule, OMG entry points. OMG lines have `missing_qty` set manually by staff
today (`setItemMissing`, `src/OmgOrderPortal.js:367`); the station's `short_qty`
stays a separate packer-declared signal, and the OMG portal's "· N short" chips
should show both.

Gap being filled: no human-driven bagging record exists. `line_status='bagging'` is
inferred from production jobs; `so_jobs.packed_at` is per-decoration-job, not
per-customer-order. Nothing records which items actually went into which bag, by whom,
or when — and shortages live in packers' heads.

## UX flows

### Packer flow (tablet, portrait or landscape)

1. **Station home** — list of batches ready to bag: store name, batch label,
   `N of M orders bagged`, sorted by store close date. A batch is "ready" when its
   orders' jobs are packed (all lines at `line_status>='bagging'`) or staff force-release it.
2. **Batch view** — big **"Next order"** button plus a searchable order list
   (player name / number / buyer) for out-of-sequence grabs. Progress bar `14 / 42`.
3. **Order screen** (the core):
   - Header: **player name + number huge**, buyer name small, order # small.
   - One row per line item: product name, **size in a large chip**, qty, variant,
     bundle children indented under their parent. Tap row → checked (green, strikethrough);
     tap again → uncheck. Qty >1 shows a stepper (`2 of 3`) instead of a single toggle.
   - Every tap writes immediately (survives tablet death / shift change).
   - **"Can't find it"** on each row → marks the line short (prompt: how many missing,
     optional note), row turns amber, packer continues.
   - When all lines are checked or shorted → auto-advance: **bag label prints**, brief
     full-screen confirmation ("Bag 15 of 42 · Jimmy Smith #23"), next order loads.
4. **Batch complete** — "All 42 orders bagged. 3 on Resolve list." If Resolve list is
   empty: **"Create club shipment"** button → existing box-tracking flow. If not:
   list the shorts and block shipment creation.

### Staff flow (desktop, Webstores → store → Batches tab)

- Each batch row shows live bagging progress (`14/42 bagged · 2 short`).
- **Resolve list** per batch: each shorted line with buttons
  **Found** (clears short, packer re-opens bag to add), **Pull from stock** (link to
  inventory search; clears short when confirmed), **Accept short** (records
  `backorder_eta` + note; line ships short and the bag label note stands).
- Club shipment creation (`webstoreToShipStation` / box-tracking entry points) is
  **blocked while the batch has unresolved shorts** — hard gate with an override
  requiring a typed reason (logged).

### Bag label (4×6)

```
┌──────────────────────────────┐
│  #23  JIMMY SMITH            │  ← number + player name, huge
│  Lakeville Soccer Club       │  ← store name
│  Bag 15 of 42                │
│  ─────────────────────────── │
│  1× Tiro25 Pant  YM          │  ← contents, size chips
│  2× Squadra Jersey  YM       │
│  1× Team Hoodie  YS  ⚠ SHORT │  ← shorted lines flagged
│  ─────────────────────────── │
│  [QR: /bagging-station?scan=WO-<order_id>]   NSA │
└──────────────────────────────┘
```

QR reopens the order on any station tablet (re-check, add found items, reprint).

## Data model (one migration: `supabase/migrations/2026xxxxxxxxxx_bagging_station.sql`)

Follow the repo's current timestamp naming and the RPC style of
`00192_job_stage_machine.sql` (SECURITY DEFINER, race-safe, event-logged).

### New columns

`webstore_orders`:
- `bagging_claimed_by text` — station/packer identity (station token name or user email)
- `bagging_claimed_at timestamptz` — claims older than 15 min are treated as stale and
  reclaimable (no cron needed; staleness computed at read time)
- `bagged_at timestamptz`, `bagged_by text`
- `bag_seq int` — "Bag 15 of 42", assigned at completion within the **bag group**
  (native batch = orders sharing `so_id`; OMG sale = orders sharing the shadow
  `store_id`)

`webstore_order_items`:
- `bagged_qty int not null default 0` — the tap counter (≤ `qty`)
- `short_qty int not null default 0` — packer-declared missing (distinct from the
  existing `missing_qty`, which vendor/receiving flows already write)
- `short_note text`, `short_status text check (short_status in ('open','found','pulled','accepted')) `,
  `short_resolved_by text`, `short_resolved_at timestamptz`

### New table

```sql
create table bagging_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references webstore_orders(id),
  item_id uuid references webstore_order_items(id),
  event text not null,          -- claim|release|check|uncheck|short|unshort|complete|reopen|label_print|resolve
  qty int, actor text, note text,
  created_at timestamptz not null default now()
);
```

Audit trail + the data for "how long does a bag take" later.

### RPCs (all SECURITY DEFINER, staff- or station-token-gated)

- `bagging_claim_order(p_order_id, p_actor)` — atomic
  `UPDATE ... WHERE bagging_claimed_by IS NULL OR bagging_claimed_at < now()-interval '15 min' OR bagging_claimed_by = p_actor`;
  returns claimed row or raises. This is the 2-packer collision guard.
- `bagging_release_order(p_order_id, p_actor)`
- `bagging_check_item(p_item_id, p_qty, p_actor)` — sets `bagged_qty` (clamped 0..qty), logs event
- `bagging_short_item(p_item_id, p_short_qty, p_note, p_actor)` — sets `short_qty`,
  `short_status='open'`
- `bagging_complete_order(p_order_id, p_actor)` — verifies every line has
  `bagged_qty + short_qty >= qty`, stamps `bagged_at`/`bagged_by`, assigns `bag_seq`
  (max+1 within `so_id`), releases the claim. Does **not** touch `line_status`
  (see monotonic-status note below).
- `bagging_resolve_short(p_item_id, p_resolution, p_note, p_actor)` — resolution in
  ('found','pulled','accepted'); 'found' also resets the line so the bag can be reopened.
- `bagging_next_order(p_group_kind, p_group_id, p_actor)` — server picks + claims the
  next unbagged, unclaimed order in one call (avoids two tablets racing "Next").
  `p_group_kind` in ('so','store'): 'so' matches `webstore_orders.so_id` (native
  batch), 'store' matches `webstore_orders.store_id` (OMG shadow store).
- `bagging_batch_progress(p_group_kind, p_group_id)` — counts for the progress bar
  and Batches tab (total / bagged / claimed / open shorts).

Status interplay — **do not** write `line_status` from bagging RPCs in v1. The
monotonic trigger chain (`00037_webstore_status_monotonic`, `00213_line_status_from_jobs`)
owns that column; fighting it risks regressions across OMG/teamshop/coach views. The
customer-facing "Bagging" stage keeps its current meaning; `bagged_at` is the new
source of truth for actual bag state. Revisit wiring `bagged_at → line_status` only
after v1 ships (listed under Later).

### Ship gate

`bagging_open_shorts(p_group_kind, p_group_id) returns int` — used client-side in
`Webstores.js` to disable/guard `webstoreToShipStation`, `printShipLabels`, and the
box-tracking club shipment entry point for that batch, and in `OmgOrderPortal.js` to
guard `printOmgLabels` and the "Move all → Shipped" bulk action. Override path: confirm dialog requiring a typed
reason → logged to `bagging_events` as `resolve`/`note`. (Client-side gate is
acceptable v1: these actions are staff-only surfaces.)

## Client build

### New files

```
src/baggingstation/BaggingStation.js   — the kiosk app (mirror FloorStation.js structure:
                                          sign-in or ?token= station mode, wake-lock,
                                          big-target styles, error toasts)
src/baggingstation/bagLogic.js         — PURE helpers, no React/supabase/window
                                          (mirror floorLogic.js so it unit-tests directly)
src/baggingstation/bagLabel.js         — buildBagLabelHtml(order, items, opts) → 4×6 HTML
src/__tests__/bagLogic.test.js
src/__tests__/bagLabel.test.js
```

`bagLogic.js` contents (all pure):
- `orderProgress(items)` → `{checked, short, total, complete}` incl. qty>1 math
- `sortLinesForBag(items)` — bundle parents first, children indented, then size order
  (reuse/extract the `SIZE_ORDER` ranking already in `floorLogic.js` — export it from
  one place rather than copying; this repo already has too much hand-synced duplication)
- `claimIsStale(claimedAt, now)` — the 15-min rule
- `nextOrderPick(orders)` — client-side fallback ordering (bag_seq null, oldest first)
- `shortSummary(items)` → label warning lines

### Routing & shell

- `src/lib/hostRouting.js` — add `isBaggingStationPath(path)` for `/bagging-station`
  (copy the `/floor-station` path-exact pattern at line 33).
- `src/index.js` — `const BaggingStation = React.lazy(() => import('./baggingstation/BaggingStation'))`
  next to the FloorStation lazy import (line 88), same Suspense fallback.
- Station auth: reuse FloorStation's model exactly (staff sign-in OR `?token=` station
  token). No new auth machinery.

### Screens (inside BaggingStation.js)

1. `BatchPicker` — a union of two queries, one card list:
   - Native batches: `sales_orders` joined to `webstore_orders` (`so_id`), stores
     `org_type='team'` with `delivery_mode='deliver_club'`, progress < 100%.
   - OMG sales: `webstores` with `source='omg'` joined to `omg_stores` on
     `omg_sale_code` where `omg_stores.delivery_mode='deliver_school'`, having
     unbagged orders.
   Each card shows store, label, kind badge (Club batch / OMG school), progress via
   `bagging_batch_progress`.
2. `BatchBoard` — Next-order button (`bagging_next_order`), search box, progress bar.
   Subscribe to Supabase realtime on `webstore_orders` (`so_id=eq.<id>`) so two tablets'
   progress bars stay live.
3. `OrderBag` — the check-off screen. Optimistic UI: tap flips the row instantly,
   RPC confirms; on RPC failure revert + toast. All rows resolved → call
   `bagging_complete_order`, print label, show confirmation for ~2.5 s, auto-load next.
   OMG-specific: lines still at `line_status='on_order'` render grayed
   ("on order — not arrived"), untappable, and don't block leaving the order
   partially bagged; they are a *wait*, not a short.
4. `ResolvePanel` (also embedded in desktop Batches tab) — open shorts with the three
   resolution actions.

### Printing (v1: browser print, no new infra)

- `bagLabel.js` builds a 4×6 HTML page (`@page { size: 4in 6in; margin: 0 }`), QR via
  the existing `qrSvg`/`barcodeSvg` utilities in `src/utils.js`, printed through the
  existing `printHtml` helper (same path the packing slips use).
- Tablet is paired to the thermal printer at OS level (AirPrint / Mopria — Rollo and
  Zebra ZD421 both support it). First print of a session shows the print dialog;
  "remember printer" makes subsequent prints ~2 taps.
- **Deferred, not v1**: silent printing via a print relay (tiny Node service or
  PrintNode subscription watching a queue table). Slot it in only if the dialog taps
  prove annoying in real use. `bagLabel.js` output is the same either way.

### Desktop touches (`src/Webstores.js` — keep minimal, it's 13.3k lines)

- Batches tab rows: bagging progress chip (one query via `bagging_batch_progress`).
- Batch detail: Resolve list section (render `ResolvePanel`).
- Ship gate on the three shipment entry points (above).
- "Open in Bagging Station" link (QR + URL) per batch for easy tablet onboarding.

### Scan deep link

`/bagging-station?scan=WO-<order_id>` opens that order directly (after claim). This is
the QR on every bag label. Keep it inside the station route — do **not** extend the
global `?scan=` IF/PO resolver in `App.js` (that's desktop-oriented; scope stays tight).

## Step-by-step build order

Each step leaves the app working; ship as one PR with commits per step, or split
PRs at step 4 if review size demands.

1. **Migration** — columns, `bagging_events`, all RPCs, grants. Test RPCs directly
   with SQL (claim race: two concurrent claims → exactly one wins; both group kinds).
2. **Ingest guard** — `netlify/functions/_shared.js`: keep `bagged_qty`/`short_*`
   out of the update set (they aren't `ITEM_CONTENT_KEYS`, so assert it with a test)
   and extend the leftover-delete guard (`syncOrderItems`, lines ~383-391) so
   `bagged_qty > 0` or `short_status='open'` counts as fulfillment progress. Test:
   re-ingest the same packing slip over a part-bagged order → progress intact.
3. **`bagLogic.js` + tests** — pure logic first, incl. extracting the shared size-order
   ranking out of `floorLogic.js` (import from a shared module; update floorLogic
   imports; run `src/__tests__/floorStation.test.js` to prove no regression).
4. **`bagLabel.js` + tests** — snapshot-style tests: contents, short flag, QR payload,
   bag N of M.
5. **Station shell** — routing (`hostRouting.js`, `index.js`), auth reuse, `BatchPicker`.
   Verify `/floor-station` still routes.
6. **`BatchBoard` + `OrderBag`** — the core loop: next → claim → tap → complete →
   print → next. Realtime progress. Optimistic writes with revert.
7. **Shortage flow** — "Can't find it" prompt, amber rows, label short flag,
   `ResolvePanel` on the tablet's batch-complete screen.
8. **Desktop integration** — Batches tab progress chip, Resolve list, ship gate,
   station link/QR. Same treatment in `OmgOrderPortal.js`: progress chip on the
   header, Resolve list, gate on `printOmgLabels` and "Move all → Shipped",
   grayed `on_order` handling verified against a live OMG sale.
9. **Batch-complete → shipment prompt** — wire to the existing box-tracking flow;
   for OMG deliver-to-school sales this creates the school delivery's first-ever
   contents record.
10. **Polish + hardware pass** — wake lock, stale-claim UX ("Claimed by Front Tablet
   3 min ago — take over?"), print CSS verified on the actual Rollo/Zebra, empty
   states, offline toast.
11. **Test sweep** — `npm test` green; manual script: two browsers as two stations on
    one batch (claim collision, live progress), short → resolve → reopen → reprint,
    ship gate block + override.

## Acceptance criteria (v1 done means)

- Two tablets can work the same batch and never open the same order.
- Killing the tablet mid-bag loses nothing; reopening the order shows checked state.
- A completed bag = printed 4×6 label with correct contents, shorts flagged.
- Batches tab shows live `bagged/total · shorts` without refresh.
- Club shipment for a batch with open shorts is blocked until each short is
  found / pulled / accepted (or explicitly overridden with a reason).
- An OMG deliver-to-school sale appears in the BatchPicker, bags exactly like a club
  batch (with `on_order` lines grayed, not shorted), and its "Move all → Shipped" /
  label actions respect the same short gate.
- Re-ingesting an OMG packing slip over a part-bagged order changes no `bagged_qty`,
  `short_*`, or bag labels (regression test on `syncOrderItems`).
- `npm test` passes; no changes to `line_status` trigger behavior.

## Phase 2 (explicitly out of v1)

- **At-once ship-home orders**: a second queue (converted teamshop/club-store orders,
  `ship_method` home, plus OMG `ship_home` sales); completion buys the ShipStation
  label via the existing paths (`createWebstoreLabel` for native,
  `printOmgLabels`/`ssPayload` for OMG — which already handles `shipped_qty`,
  short-aware ship plans, and webhook cost reconciliation) and marks shipped —
  packer never touches a desktop.
- **Scan-to-verify**: reuse `BarcodeScanner` (`src/CoachPortal.js:2498`) to scan garment
  UPC/size tags where they survive decoration; tap remains the fallback.
- **Silent printing** via print relay/PrintNode if the AirPrint dialog is friction.
- **`bagged_at` → `line_status`** wiring, once trigger interplay is mapped.
- Bagging throughput analytics from `bagging_events` (bags/hour, shorts by product).

## Open questions (fine to resolve during build)

- Batch "ready to bag" definition: strictly all-jobs-packed, or staff force-release?
  (Plan assumes both: auto-ready plus a force-release button on the Batches tab.)
- Does `bag_seq`/"Bag N of M" reset if orders are added to a batch late? (Plan: M is
  live count; seq never reassigned.)
- Packer identity granularity: per-station token (v1 plan) vs per-person PIN. Events
  record `actor` either way, so upgrading later is additive.
