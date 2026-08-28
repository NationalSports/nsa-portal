# Move Check-In station — September building move

Live at **`/move-checkin`** (staff sign-in). Phone-first, and from 900px wide a
landscape tablet gets the full-page layout: bigger type and tabs, the scanning
tabs split into scanner-left / live "just checked in" feed-right, the Boxes tab
becomes a 2–3 column grid, and the box sheet opens as a centered dialog. Everything that enters
the new building gets scanned here, so the boxes table becomes the moving
inventory: what arrived, what it belongs to, and what shelf it's on.

Rides on the existing BX-plate box system (`BOX_TRACKING_PLAN.md`, migration
00185). Migration `20260824120000_move_checkin.sql` adds `checked_in_at`,
`checked_in_by`, and `assigned_to` to `boxes`; shelf placement uses the `bin`
column 00185 already reserved.

## How the team uses it

1. **Check In tab** — tap Start Scanning once; the camera stays live. Point at
   each box's QR as it comes off the truck: green + chirp = checked in, amber =
   already done, red = unknown. Old pre-plate labels (QR encodes IF#/PO#)
   resolve to their boxes; if an IF has several boxes you pick which (or "all").
   A BX plate not in the table is adopted as a new checked-in box.
2. **Place tab** — the move is three stages: **checked in → staging → on
   shelf**. Pick **Staging zone** (e.g. `STAGE 1`) or **Final shelf** (e.g.
   `A3`), type the code once (it locks), then scan box after box into it.
   Staging is the temporary drop zone; a later shelf scan finalizes the box
   (and clears its staging area). Scanning here also checks in a box that
   skipped step 1. The header shows per-stage progress and a bar; the Boxes
   tab filters by stage (Unplaced / Staging / On shelf).
3. **No QR code?** On the same Check In screen, tap **📝 No QR — add by hand**:
   enter the SO# and contents (Job = free text, Inventory = SKU + per-size
   counts), and a 4×6 BX QR label prints (stick it on — the box is scannable
   from then on).
4. **🔍 Find a box** (button on the Check In screen, not a tab) — search by
   box/SO/shelf/staging/item, filter by stage, and per-box actions: send to
   staging or shelf, **edit contents**, toggle counts-toward-inventory, print
   label, undo check-in.
5. **Submit tab** — **⬇ Download CSV** saves the whole review
   (counted old→new, zero-outs with confirmation status, unmatched SKUs) as
   the stocktake paper trail before writing the numbers.

While scanning, an **↩︎ Undo last scan** button reverses the most recent
check-in/placement (an adopted unknown plate is deleted outright).

Desktop nav: Tools → Move Check-In; also a **📦 Move Check-In** button on the
Inventory page's tab row (opens in a new tab). Code: `src/movecheckin/` (pure helpers in
`moveLogic.js`, unit tests in `src/__tests__/moveCheckin.test.js`).

## Shipped boxes — automatic

A box whose whole order has left is marked `shipped` automatically: when an SO
is shipped (`_shipped` / `_shipping_status`) or every non-draft job on it is
completed/shipped, App.js's reconciliation effect flips every box referencing
that SO (a multi-SO box waits until ALL its orders are done — "when everything
goes"). Shipped boxes drop out of the stage counts, on-hand picture, and
inventory tally, and are findable under the Shipped filter. Caveat: the
reconciliation runs client-side, so it applies while someone has the desktop
or mobile portal open — the station alone doesn't run it.

## Splitting a mixed carton

Batch shipments often land embroidery, DTF, and screen-print goods for several
jobs in one carton. After scanning it in, tap **Open BX-… — split / edit** on
the green banner (or find the box), then **✂️ Split box**:

- **By job / SO** (the default) — one tap groups the lines by their SO: the
  first SO's lines stay in the scanned carton, every other SO gets its own new
  BX box.
- **Each line** — every content line becomes its own box.
- Or tap any line to cycle it between Keeps / New 1 / New 2 / … by hand (the
  operator's eyes are the deco-type detector — data can't always tell
  embroidery from DTF, people can).

**Split + print labels** mints the new plates, inherits the carton's check-in
stamp, location, and inventory assignment onto each new box, shrinks the
original to what stayed, and prints one 4×6 label per new box.
