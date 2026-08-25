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

## Known gap: shipped boxes

Nothing marks a box `shipped` automatically — the ship flow does not touch the
`boxes` table, so status is only set by hand (desktop box modal) or by
combining. A box that IS marked shipped is now excluded from the move's stage
counts, the on-hand picture, and the inventory tally (`boxStage` → `shipped`),
and is findable under the Shipped filter. Auto-marking boxes shipped when their
order ships is the obvious follow-up.
