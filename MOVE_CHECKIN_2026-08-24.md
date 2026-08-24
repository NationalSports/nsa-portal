# Move Check-In station — September building move

Live at **`/move-checkin`** (phone-first, staff sign-in). Everything that enters
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
3. **No QR tab** — pre-QR-era boxes: enter the SO# and contents (one line per
   item, "12 x navy hoodies"), assign to **Job** or **Inventory**, and a 4×6 BX
   QR label prints (stick it on — the box is scannable from then on).
4. **Boxes tab** — progress (checked in / today / need a shelf), search by
   box/SO/shelf/item, and per-box actions (set shelf, print label, undo).

Desktop nav: Tools → Move Check-In. Code: `src/movecheckin/` (pure helpers in
`moveLogic.js`, unit tests in `src/__tests__/moveCheckin.test.js`).
