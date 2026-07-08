# Mobile Warehouse Capabilities — Research & Upgrade Plan

**Date:** 2026-07-07
**Context:** Warehouse staff do most check-in (PO receiving) and IF work (pulling Item
Fulfillments) on phones and tablets, not computers. This doc maps what the mobile
experience can and can't do today, flags two bugs found along the way, and recommends
upgrades in priority order.

**Bottom line:** The mobile foundation is better than expected — a dedicated
mobile-first portal (`src/MobilePortal.js`) already covers Pull IFs and Check In POs
with touch-sized controls. But the warehouse's highest-leverage tool, **camera
scanning, does not exist on mobile at all**: the camera scanner component is only
wired into the desktop page (where the reference is currently broken), and the QR
labels the warehouse prints every day **deep-link only into the desktop UI — a phone
that scans one lands on the mobile home screen with nothing happening**. Shipping
(boxes, weights, carrier labels) is desktop-only, and there is no PWA install, so
phones use it as a browser tab. The top three upgrades below are small, connect
already-built pieces, and would let a picker go label → scan → screen in one motion.

---

## Part 1 — What exists today (verified)

### The mobile portal

`src/MobilePortal.js` (~184KB) is a purpose-built, mobile-first staff app — bottom tab
bar, sticky headers, safe-area insets, `100dvh` layout (`portal.css:283+`). It
activates automatically on touch devices ≤1024px wide (`App.js:5243–5245`,
`_isTouchDevice`) and replaces the entire desktop portal (`App.js:29486`). Users can
toggle back with a persistent localStorage preference. **Tablets get the mobile
portal by default too** — anything ≤1024px CSS width.

Warehouse users get a role-aware experience: `warehouse`/`production` roles see an
ops home screen (`renderWhHome`, `MobilePortal.js:1055`) with no sales/financial
stats, and a Warehouse section with two tabs (`MobilePortal.js:1554`):

- **Pull IFs** — tap cards per pick (IF#, SO, ship-dest badge, due date) → detail
  with per-size number inputs (`inputMode="numeric"`, 48px touch targets), stock
  shown per size, sticky "✓ Mark Pulled (n units)" button (`MobilePortal.js:1383–1420`).
  Calls the same `onPullIF` handler as desktop — decrements inventory, notifies the
  rep, recalcs job fulfillment.
- **Check In POs** — search + Open/All filter, purple batch cards for batch POs,
  multi-select **Batch Check In** with a review screen for partial quantities
  (`MobilePortal.js:1423–1531`). Drop-ship POs are correctly filtered out. Calls the
  same receive handlers as desktop and prints flow through the shared label pipeline.

There's also a read-only mobile inventory search (`MobilePortal.js:1733–1762`) and a
PO status panel inside SO details with a "Check In N units →" deep link
(`MobilePortal.js:323–378`).

### Camera scanning infrastructure (exists, but not on mobile)

A genuinely good scanner component exists — `BarcodeScanner` in
`src/CoachPortal.js:2498–2617`: rear camera via `getUserMedia`, native
`BarcodeDetector` with the `barcode-detector` polyfill (`package.json`), 9 barcode
formats, **flashlight/torch toggle** (comment: "warehouse aisles are dim"), haptic
feedback on hit, and a **tesseract.js OCR fallback** for reading printed PO numbers
when barcodes fail. Manual typing fallback included.

It is used in three desktop-only places: the warehouse Scan-to-Receive tab
(`App.js:16158`, `:16287`) and the global scan modal (`App.js:30179`).

### Printed QR labels + deep links

Pull and receive both auto-print 4×6 QR labels (`printQrLabel`, `App.js:15881`,
`:11291`). The QR encodes `?scan=IF-…/PO-…` URLs. On desktop, a boot-time effect
(`App.js:29441–29450`) reads `?scan=` and `handleScanResult` (`App.js:29380`)
navigates to the right record (IF → warehouse pull, PO → receive, SO → order, batch →
batch POs).

### What's desktop-only

- **Shipping/box building**: the entire box builder (weights, L×W×H, carrier,
  per-box item allocation, tracking) and **ShipStation label purchase** live only in
  the desktop warehouse page (`App.js:15963–16079`, `:16627+`). Mobile users can pull
  and receive but cannot ship.
- **Bin locations**: `products.bin` exists (migration 034) and shows as 📍 chips in
  the desktop pull table and IF detail (`App.js:16569`, `:15791`) — but the mobile
  pull detail does not display bins, and bins are editable only in the desktop
  product panel (`App.js:8650`).
- **Pull assignment**: warehouse leads assigning pulls to workers is desktop-only
  (`App.js:15632`, `_whOpenAssign`).
- **Inventory adjustments**: desktop-only; mobile inventory is read-only.

### Not a PWA

No `manifest.json`, no service worker, no install prompt; `index.html` explicitly
sets no-cache headers (there's a deploy-reload watcher instead). The app is
online-only and lives as a browser tab on warehouse devices.

---

## Part 2 — Bugs found during research

1. **Desktop scanner reference is broken (high confidence, code-level).**
   `BarcodeScanner` is referenced 3× in `App.js` (16158, 16287, 30179) but is neither
   imported nor defined there — the only definition is un-exported inside
   `CoachPortal.js:2499`, and no bundler shim exists (checked `craco.config.js`).
   Rendering the warehouse Receive tab or tapping the header Scan button should throw
   a `ReferenceError`. Verified by exhaustive occurrence count over the full file
   (which bypasses the known control-byte grep blindness); **not** runtime-verified —
   worth one manual click before/after fixing.

2. **QR deep links are silently swallowed on phones.** The `?scan=` boot effect calls
   `handleScanResult`, which only sets **desktop** navigation state (`setPg`,
   `setWhViewIF`, …) and never exits mobile mode. On a phone (mobile mode defaults on
   for touch devices), scanning a printed 4×6 label with the camera app opens the
   site, strips the param, and shows the mobile home screen — the scan goes nowhere.
   The warehouse's printed labels are effectively desktop-only artifacts today.

---

## Part 3 — Recommended upgrades, in priority order

### P0 — Connect what's already built (small, days not weeks)

1. **Make `BarcodeScanner` a shared component and fix the desktop references.**
   Move it from `CoachPortal.js` to `components.js` (or export + import), one
   definition, imported by desktop, mobile, and coach surfaces. Fixes bug #1 and is
   the prerequisite for everything below. Per `FABLE_WORKING_PROCESS.md`: reduces a
   copy-risk instead of adding one. *(S)*

2. **Camera scan in the mobile warehouse.** Add a Scan button to the mobile
   warehouse header (and ops home screen) that opens the shared `BarcodeScanner` and
   routes the result to the right mobile detail: `PO-…`/`NSA-…` → receive detail
   (`openPO`/`openBatchByNumber`), `IF-…` → pull detail (`openIF`), SO → order
   detail. The torch + OCR fallback already handle warehouse conditions. This is the
   single biggest workflow win: pick up box, scan, count, tap. *(S–M)*

3. **Route `?scan=` deep links in mobile mode.** When the boot effect sees `?scan=`
   and `mobileMode` is true, hand the value to the mobile scan router from item 2
   instead of the desktop `handleScanResult`. Every already-printed label instantly
   becomes phone-scannable with the native camera app — no reprinting. *(S)*

4. **Show 📍 bin on mobile pull cards and detail.** The data is already on the
   product (`products.bin`); the desktop pull UI shows it; mobile pickers walking
   aisles are the audience that needs it most. One chip per line. *(S)*

### P1 — Close the workflow gaps

5. **PWA install (manifest-first).** Add `manifest.json` + icons +
   `display: standalone` + theme color so warehouse devices install it to the home
   screen and run full-screen. **Recommendation: skip the service worker for now** —
   the app has a deliberate no-cache/force-reload deploy strategy that a SW would
   fight; a manifest alone gives the install/full-screen win with zero cache risk.
   Add a screen wake-lock (`navigator.wakeLock`) while a pull/receive detail is open
   so the screen doesn't sleep mid-count. *(S)*

6. **Tablet ship step.** A mobile-layout box/ship flow for the IF detail: add box →
   weight/dims/carrier → "Create Label" via the existing
   `createShipStationLabel` — plus the "mark shipped without label" escape hatch that
   desktop has. Even a v1 that only supports one box per IF removes the walk to a
   computer. Note the desktop print trick (hidden iframe + `.print()`) is unreliable
   on mobile Safari — on mobile, open the label PDF via share-sheet/new tab instead.
   *(M)*

7. **Batch-PO receive scanner loop.** Desktop receive has "Scan next PO…" for
   continuous receiving; give mobile batch mode the same scan-next loop so freight
   days are scan → count → scan → count without list navigation. *(S, once #2 lands)*

### P2 — Bigger bets, in this order

8. **Build BOX_TRACKING_PLAN Phase 1 (BX-#### license plates), mobile-first.** The
   design (approved, unbuilt — `BOX_TRACKING_PLAN.md`) is inherently a phone feature:
   scan a box → action modal (Take to Deco / Combine / Add items). Boxes today are
   ephemeral UI state (`whViewIF._boxes`) that reset on every open; the plan's
   `boxes` table fixes that and unlocks "where is IF-1071" answers from the floor.
   Implement the scan-action modal in the mobile portal first, desktop second. *(L)*

9. **Mobile inventory actions.** Per-size adjust (writing `invAdjLog` like desktop)
   and bin assignment (reusing the `BINS` datalist) from the mobile inventory view —
   lets cycle counts and re-binning happen in the aisle. Also fix the mobile
   inventory search to use controlled state + debounce (currently reads an
   uncontrolled input via `getElementById` each render and re-filters the whole
   catalog per keystroke — laggy on phones). *(M)*

10. **Lead tools on mobile:** assign/delegate pulls (currently desktop-only) so a
    lead on the floor can hand tasks to workers. *(S–M)*

### Explicitly not recommended right now

- **Offline mode / service worker caching** — real engineering cost, conflicts with
  the deploy-reload design, and the flows are short transactions; fix installability
  first and revisit only if warehouse Wi-Fi is actually a complaint.
- **A native app / React Native wrapper** — the web portal + PWA install covers the
  need; a wrapper adds a whole release channel to maintain.
- **Making the desktop warehouse tables responsive** — the mobile portal is the
  answer to phones; retrofitting the 14-column desktop pull table would duplicate
  what MobilePortal already does well (and this codebase's audit history warns
  exactly against more hand-synced duplicates).

---

## Assumptions & open questions

- **Assumed** "check in" = PO receiving and "IF" = Item Fulfillment pulling, matching
  the app's own vocabulary. If warehouse also means something else by check-in
  (e.g., deco check-in), say so and I'll extend the map.
- **Assumed** warehouse phones/tablets run the mobile portal (the default for touch
  devices). If some tablets are >1024px CSS width in landscape, they get the desktop
  UI — worth confirming which devices are actually in use.
- Bug #1 (broken desktop scanner reference) is verified at the code level but not by
  running the app; if the desktop Scan button demonstrably works in production,
  something unusual is resolving the symbol and I'd want to know what before touching it.
- Effort tags: S = hours–a day, M = days, L = week+.
