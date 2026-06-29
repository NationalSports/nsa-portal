# Unified Deco Order Flow — Step-by-Step Spec

**Date:** 2026-06-26 · Supersedes the routing-toggle framing in `ART_PO_CLICK_LEDGER_2026-06-26.md`.
Incorporates PR **#1226** (decorator ship-to address) and the **soft `Outside` flag + batch** model.

> Read each step as four lines — **Do** (the rep's action) · **See** (what's on screen) ·
> **Writes** (the DB fields) · **State** (resulting border/badge + job/PO/cost effect).

---

## 0. The model in one screen — two independent axes

A decoration now has **two separate properties** that used to be fused:

```
   WHAT is decorated (the design)              HOW it's fulfilled (routing)
   ───────────────────────────────            ─────────────────────────────
   • placement                                 fulfillment:  (null = in-house) | 'outside'
   • deco type (SP / EMB / DTF / HP)           deco_po_id:   set when bundled onto a deco PO
   • art: real file / New Art TBD / pricing    ───────────────────────────────
   • customer SELL price                       Outside is a SOFT FLAG — set per card OR in bulk.
   ───────────────────────────────             The deco PO is where outside COST is committed,
   identical whether in-house or outside        and ONE PO can bundle many outside decos.
```

**The single gate, read everywhere (jobs + costs):**

> A decoration is **outsourced** (→ no in-house job, cost comes from the PO) when
> `deco_po_id` is set **OR** `fulfillment === 'outside'` (plus legacy `kind:'outside_deco'`
> and a type-matching SO-level deco PO). Otherwise it's **in-house** (→ production job,
> cost from the in-house tables).

Two consequences that make the soft flag safe:
1. **Flag suppresses the job immediately** — a deco marked `outside` never spawns a job, even before its PO exists, so you can assemble the order without premature jobs.
2. **The PO adds the authoritative cost** — until a PO is attached, an outside deco shows a
   **"needs PO" chip**; once bundled, `deco_po_id` is stamped and the PO's rate is the cost of
   record (Phase 1 already removes the in-house duplicate; #1226 shows the PO as a $0 slot to fill).

---

## 1. Data model deltas

| Where | Field | Notes |
|---|---|---|
| `estimate_item_decorations`, `so_item_decorations` | **`fulfillment TEXT`** | `null` = in-house (default) · `'outside'` = flagged outside. Migration `00153`. |
| same | **`deco_po_id TEXT`** | set when the deco is bundled onto a deco PO; the precise in/out switch. |
| `src/constants.js` | add `fulfillment`, `deco_po_id` to `_decoCols` + `_decoExtraCols` | so they persist + survive a schema-cache retry. |
| `deco_pos` (SO JSONB) | **`deco_refs:[{item_idx,deco_index}]`** | target specific designs; `item_idxs` kept (derived) for the ~8 call-sites that read it. |
| **reuse from #1226** | `deco_vendors.address`, `decoShipForItems(itemIdxs)` | decorator drop-ship Ship-To — already built; the bundling step calls it. |

`isDecoOutsourced()` (businessLogic.js, added in Phase 1) gains one clause:
`d.fulfillment === 'outside' || d.deco_po_id || …existing`.

---

## 2. The worked example

**Servite Friars — Spring Order** (one customer, four lines):

| Line | Garment | Qty | Decorations | Intended fulfillment |
|---|---|---|---|---|
| 1 | Squadra25 jersey | 24 | front logo (SP) · back numbers · back names | **in-house** |
| 2 | Hoodie | 12 | front embroidered crest | **outside → Olympic** |
| 3 | Polo | 12 | left-chest embroidered crest | **outside → Olympic** |
| 4 | Coaches' jacket | 6 | large 12-color back print | **outside → Silver Screen** |

Lines 2 & 3 go to the **same vendor (Olympic)** → they bundle onto **one** deco PO. Line 4 → its own PO to Silver Screen. This is the batch case.

---

## Phase A — Estimate (no routing committed; pricing only)

Decorations are built **identically** regardless of eventual routing. Estimates have no jobs and no POs, so nothing is committed here.

**A1 — Create estimate, pick customer.**
- *Do:* New Estimate → search "Servite" → pick.
- *Writes:* new `estimates` row, `customer_id`.

**A2 — Add Line 1 (jersey) + its three decorations.**
- *Do:* Add product Squadra25, color, size grid 24. Then **+ Add Art** (front logo → pick existing Friars logo, placement Front Center), **+ Numbers** (back), **+ Names** (back).
- *Writes:* item with `decorations:[{kind:'art',art_file_id:<logo>,position:'Front Center'}, {kind:'numbers',…}, {kind:'names',…}]`. **No `fulfillment`** (null).
- *See:* three decoration cards, blue/green/amber left borders (today's kinds). Sell prices auto-compute.
- *State:* all in-house by default (null). No badge clutter.

**A3 — Add Lines 2, 3, 4 with their crest / back-print art.**
- *Do:* For each, add product + an art deco. Line 2 & 3 crests → **➕ New Art TBD** (creates `ART TBD 1/2`, type Embroidery, stitch bracket for pricing). Line 4 → New Art TBD, Screen Print, 12 colors.
- *Writes:* art-style decos, `fulfillment` still null.
- *Decision available now (optional):* the rep **may** pre-flag outside here (see Phase C) — but on an estimate it changes nothing downstream, so most reps leave it. **Routing is genuinely deferrable.**

**A4 — Send estimate.** Customer sees only sell prices (identical regardless of who decorates). Approve.

> **Options at A:** for every art deco the rep chooses **design** (existing / New TBD / pricing-TBD) and **complexity** (colors/stitches). Routing is *available but optional* — defer it.

---

## Phase B — Convert estimate → Sales Order

**B1 — Convert to SO.**
- *Do:* one click, **Convert to SO**.
- *Writes:* `sales_orders` row; decorations + art files carried over verbatim (`fulfillment` still null).
- *System:* `syncJobs()` runs. With everything null/in-house, it builds jobs for **all** designs — including the crests and back print (they'll drop off in Phase C as they're flagged/PO'd).
- *State:* Jobs board shows jobs for L1 logo/numbers/names, L2 crest, L3 crest, L4 back print.

*(No "resolve routing" prompt — null just means in-house until flagged. The next phase removes the outside ones.)*

---

## Phase C — Mark items Outside (single + **batch**)

This is the new routing step. Two ways, same result (`fulfillment='outside'`).

**C1 — Single: flag one decoration outside.**
- *Do:* On Line 4's back-print card, click the **Outside** segment of the routing toggle.
- *Writes:* that deco `fulfillment='outside'`.
- *See:* card border turns **purple**, badge **"Outside · needs PO"** (amber sub-chip), reveal strip shows **Vendor** + **Cost/ea**. Rep picks **Silver Screen**; cost/ea auto-fills from its price list.
- *State:* `syncJobs()` drops Line 4's back-print **job immediately** (flag suppresses it). Cost not yet committed → the "needs PO" chip persists.

**C2 — Batch: flag several at once.**
- *Do:* In the Jobs/decorations view, **multi-select** Line 2 crest + Line 3 crest (checkboxes) → **"Mark Outside"** → pick vendor **Olympic**.
- *Writes:* both decos `fulfillment='outside'`, `vendor='Olympic Embroidery'`, cost/ea auto-filled.
- *See:* both cards purple, **"Outside · Olympic · needs PO"**.
- *State:* both crest jobs drop off the board. Two outside decos now await a PO for Olympic.

> **Options at C:** per-card toggle for one-offs; **multi-select "Mark Outside"** for the common many-items case. Flipping back to **In-house** is non-destructive (art/mockup/approval stay; the job simply reappears).

---

## Phase D — Create the deco PO(s) — **bundling per vendor**

A flagged-but-PO-less deco shows "needs PO." One action bundles them.

**D1 — Bundle the Olympic crests into one PO.**
- *Do:* Click **"Create Deco PO for outside items → Olympic Embroidery"** (offered because 2 outside decos share that vendor). Modal opens with **both crests pre-checked** (Line 2 + Line 3), qty summed (24), unit cost from price list, expected return date + notes.
- *Writes:* one `deco_pos` entry `{po_id:'DPO 1042 …', vendor:'Olympic', deco_vendor_id, deco_type:'embroidery', deco_refs:[{item_idx:1,deco_index:0},{item_idx:2,deco_index:0}], item_idxs:[1,2], qty:24, unit_cost, expected_cost, drop_ship?, status:'waiting'}`. **Each covered deco stamped `deco_po_id:'DPO 1042'`.**
- *See:* PO created toast; the two crest cards now show **"Outside · Olympic · on DPO 1042"** (chip, no more "needs PO").
- *State:* crests already had no job (flag); now their **cost = the PO** (Phase 1 keeps the in-house duplicate out; #1226 shows the PO row even at $0 until the rate is filled). PO appears in **Linked Documents → Decoration POs** (#1226) and as an **Outside Deco** cost row.

**D2 — Line 4 back print → its own PO to Silver Screen.**
- *Do:* "Create Deco PO → Silver Screen" (one outside deco for that vendor). Confirm qty 6, cost, notes.
- *Writes:* second `deco_pos` entry, `deco_po_id` stamped on Line 4's deco.

> **Options at D:** bundle all of a vendor's outside decos into one PO (default), or create separate POs. **Preexisting PO** mode lets the rep enter a number from a decorator's own bill instead of auto-numbering.

---

## Phase E — Blanks POs (with decorator drop-ship from #1226)

Outside decoration still needs **blank garments**, often shipped straight to the decorator.

**E1 — Order blanks for the hoodies/polos, drop-shipped to Olympic.**
- *Do:* Open the product PO for Line 2/3 blanks → pick **Drop Ship**.
- *System (#1226):* because a drop-ship deco PO (DPO 1042) covers these items, `decoShipForItems()` offers **"🎨 Olympic Embroidery (decorator)"** in **Ship To** and **selects it by default**; the printed/emailed PO ships to Olympic's saved address and the note reads "ship directly to the decorator."
- *Writes:* blank PO `po_lines` with the decorator destination.
- *State:* blanks go straight to the decorator; warehouse won't expect them.

---

## Phase F — Art & customer approval (in-house **and** outside)

Approval is identical regardless of routing — the win of the unified model.

**F1 — In-house art (Line 1 logo).** Reused Friars logo is already approved → job lands in its production-files stage; rep marks seps. (Numbers/names need no art approval.)

**F2 — Outside art (Line 2/3 crests).**
- *Do:* Olympic returns the digitized crest → rep **applies the real art** onto `ART TBD 1/2` (upload or pick existing). Then **Send mockup for approval** → recipients default-all → Send. Coach **✅ Approves**.
- *Writes:* art file `status` flows `waiting_for_art → needs_approval → approved`; mockups on `item_mockups`.
- *Crucial:* applying real art and getting customer sign-off **does NOT create a job** — the crest carries `deco_po_id` + `fulfillment='outside'`, so the gate keeps it off the board. **Approval without a job** — impossible today.

---

## Phase G — Production & close-out

- **In-house (Line 1):** jobs flow Hold → Ready → Staging → In Process → Completed → Shipped.
- **Outside (Lines 2/3/4):** tracked on the deco PO — **Waiting → Ordered → Received**; the vendor's bill is captured in `_bill_cost` (authoritative cost on the Costs tab, replacing the $0 slot).
- Receive blanks, fulfill, invoice, ship.

---

## State reference

| `fulfillment` | `deco_po_id` | Border | Badge | Job? | Cost source |
|---|---|---|---|---|---|
| null | — | blue | In-house | **yes** | in-house tables |
| `'outside'` | — | purple | Outside · **needs PO** | no | — (until PO) |
| `'outside'` | set | purple | Outside · vendor · on DPO | no | the deco PO |
| legacy `kind:'outside_deco'` | — | purple | Outside (legacy) | no | flat `cost_each` |

---

## Edge cases (all handled by the single gate)

- **Flip outside → in-house:** clear `fulfillment` (+ unlink PO). Job reappears; art/mockup/approval untouched (non-destructive).
- **Partial item:** one garment can have an **outside crest + in-house numbers** — the flag/PO is per-decoration (`deco_refs`), so only the crest is outsourced; the numbers still build a job. (This is the SO-1199 per-deco-type fix, now per-decoration.)
- **Flagged outside but never PO'd:** "needs PO" chip stays; no job, no committed cost. A conversion/checkout check can warn "N outside decorations have no PO."
- **Vendor mismatch in a bundle:** "Create Deco PO" only groups decos sharing a vendor; different vendors → separate POs.

---

## What changes vs today (summary)

| | Today | Unified |
|---|---|---|
| Create outside deco | separate `+ Outside Deco` flat object, no art | same art card; just flag **Outside** |
| Decide in/out | baked in at creation | soft flag, deferrable, **batchable**, reversible |
| Multiple items out | repeat the flat form each | **multi-select → Mark Outside → one PO** |
| Art + approval on outside | impossible (no art file) | **full art file + mockup + customer approval** |
| Job vs PO | separate logic, drift | **one gate** (`deco_po_id` \|\| `fulfillment`), jobs + costs agree |
| Cost | double-count risk (pre-Phase 1) | PO is cost of record; in-house duplicate removed |
| Blanks to decorator | manual address | **auto decorator Ship-To** (#1226) |

---

## Build sequence

1. **#1226** — rebase onto `main`, land (decorator ship-to + deco-PO visibility foundation).
2. **Phase 1** ✅ shipped — unified `isDecoOutsourced` gate (jobs + costs agree).
3. **Phase 2** — migration `00153` (`fulfillment`, `deco_po_id`); extend the gate to honor the flag; unified card + **Outside toggle**; **multi-select "Mark Outside"**; **"Create Deco PO for N outside items"**; legacy `outside_deco` renders in the new card.
4. **Phase 3** — `deco_refs` precision; Outside lane on Jobs; conversion "needs PO" check; coach approve-all; MobilePortal parity.
