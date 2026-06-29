# Artwork — Estimate → Approval, Step by Step (Inside & Outside)

**Date:** 2026-06-27 · Consolidated into PR #1422 (now includes #1397's `design_id`/`mock_links`
reuse + approval simplifications, and #1226's decorator ship-to + deco-PO visibility).

This is the **single artwork lifecycle** from the moment a design is added on an estimate to the
moment it's **approved** — covering **both in-house and outside** fulfillment, with every **branch
decision** marked **◆ Dn**. The key idea: *design, routing, and approval are three separate
tracks.* Inside and outside share the **same design and the same approval**; they diverge only at
**fulfillment** (a production job vs. a deco PO).

---

## 0. The whole flow on one line (where the branches live)

```
 ESTIMATE                                    SALES ORDER
 ─────────────────────────────────────────  ─────────────────────────────────────────────────
 add garment → +Add Art ─◆D1 design?──┐                ┌─ request art → artist uploads mockup ─┐
                          ◆D2 placement│                │   (◆D5 reuse an approved mock?)        │
                          ◆D3 routing? ─┼─ Send → Convert┤                                        │
                          (in-house |   │                └─ ◆D6 APPROVAL ─ artist→(◆D7 rep gate)→ │
                           outside flag)│                            coach → approve / changes    │
                          ◆D4 if out:   │                                                          ▼
                           vendor+cost  │                      ┌──────────── approved ───────────┘
                                        │                      │
                                        │      ◆D8 FULFILLMENT branch (decided by the deco PO):
                                        │        • IN-HOUSE → production job → prod files → art_complete
                                        └───────▶ • OUTSIDE  → no job; apply real art for sign-off, deco PO
```

**Design** (D1, D2) and **approval** (D6, D7) are *identical* inside or outside. **Routing** (D3,
D4, D8) is the only thing that differs — and it's a soft, deferrable, reversible flag that the
**deco PO** ultimately commits.

---

## Legend — the two status fields

Art moves through two fields kept in lock-step (the unified gate keeps jobs & costs honest):

| Stage | `so_jobs.art_status` | `so_art_files.status` |
|---|---|---|
| Art needed | `needs_art` → `art_requested` | `needs_art` / `waiting_for_art` |
| Artist working | `art_in_progress` | `waiting_for_art` |
| Out for approval | `waiting_approval` | `needs_approval` |
| Approved (awaiting prod files) | `production_files_needed` / `order_dtf_transfers` / `upload_emb_files` | `approved` |
| Done | `art_complete` | `approved` |

Outside-routed decorations **never get a `so_jobs` row** (the gate skips them) — but their art
file still walks `needs_art → needs_approval → approved` so the customer approves the mockup.

---

## Phase 1 — Estimate: build the design (identical for inside & outside)

**1.1 — Create estimate, pick customer, add a garment line.** Search catalog → product → color →
size grid. Garment sell auto-fills from the tier.

**1.2 — Add the decoration.** Click **+ Add Art** under the line. A decoration card appears
(`kind:'art'`, default placement `Front Center`).

> **◆ D1 — Which design backs this art?** (the art-picker dropdown)
> - **Pick an existing design** → `art_file_id = <id>`. With #1397, the picker matches prior
>   orders by **`design_id`** (stable identity, not the name string), so a renamed-but-same logo
>   still surfaces its **approved** mocks. Inherits that file's live status (often already
>   `approved`) — this is what lets a reused, pre-approved logo **skip the whole approval loop**.
> - **➕ New Art TBD** → creates a real `ART TBD N` art-file row at `waiting_for_art` (shows in the
>   Art Library, assignable to an artist). Choose when art *will* be made.
> - **🎨 Art TBD (pricing only)** → `art_file_id = '__tbd'` + a pricing type; no library entry, no
>   artist workflow. Lightest — just a number on the estimate.

> **◆ D2 — Deco type, complexity, placement.** Screen-print color count (+underbase?), embroidery
> stitch bracket, or DTF size → drives the price. Placement dropdown (Front/Back/Left Chest…).
> These are the same whether the work ends up inside or outside.

> **◆ D3 — Routing (soft flag, deferrable).** The card's **In-house | Outside** control.
> - **In-house** (default; `fulfillment = null`) → will build a production job on the SO.
> - **Outside** (`fulfillment = 'outside'`) → flagged purple; reveals **◆ D4**. Can be set per card
>   **or in bulk** (multi-select "Mark Outside" for the many-items-out case).
> - On an **estimate this commits nothing** (no jobs/POs exist yet) — routing is genuinely
>   deferrable; most reps leave it In-house and decide at the PO step.

> **◆ D4 — (if Outside) vendor + cost.** Pick the decorator; cost/ea auto-fills from that vendor's
> price list. The **customer sell price is unchanged** — routing only affects your cost/margin.

**1.3 — Send estimate.** Customer sees sell prices only; routing/jobs are internal. Approve.

---

## Phase 2 — Convert estimate → Sales Order

**2.1 — Convert.** Decorations, art files (incl. `design_id`), and pricing carry over. `syncJobs()`
runs: in-house designs build jobs; **outside-flagged (or PO'd) designs are skipped** by the gate
(`isDecoOutsourced` → `deco_po_id || fulfillment==='outside'`). No "resolve routing" nag — null
just means in-house until a PO says otherwise.

---

## Phase 3 — Art production lifecycle (request → upload → mockup)

**3.1 — Request art / assign an artist.** Job (or art row) moves `needs_art → art_requested`. With
#1397's **implicit Start Working**, the artist's first upload flips `art_requested → art_in_progress`
automatically (no separate click).

**3.2 — Artist uploads the mockup, per garment.** Per-item mockups land on
`item_mockups[sku|color]`. **#1397 `mock_links`**: one garment can **reuse another garment's
mockup** (a persisted `{garmentKey → sourceKey}` map) instead of re-uploading — and the link now
survives reload (it's a real column with realtime-merge safety).

**3.3 — LOGO-1 gate.** Before a design can go for approval it must have a canonical **`preview_url`**
(the durable, garment-independent logo image that reuse + storefront key off). Missing → blocked
with a clear message.

---

## Phase 4 — APPROVAL (the shared spine — identical inside & outside)

> **◆ D5 — Reuse a previously-approved mock?** If `priorMocks` (keyed on **`design_id`**) finds this
> design already approved on another of the customer's orders, the rep can **apply that approved
> mock** to the garment. Decision: *"already approved for this garment"* (lands straight at
> `production_files_needed`/`art_complete`, **skipping coach approval**) **vs** *"send to coach to
> confirm"* (normal path below). This is the single biggest click-saver for repeat logos.

> **◆ D6 — Send for approval.** Artist clicks **Send to Rep** → `waiting_approval` /
> `needs_approval`. Validations: all SKUs have mockups; `preview_url` present;
> `_confirmResendIfRejected` warns (and shows feedback) if re-sending over a coach change-request
> (SO-1199 rail). `coach_rejected` is cleared on a clean re-send.

> **◆ D7 — The rep gate (per-customer skippable — #1397 decision B).**
> - **Trusted customer** → the rep gate is skipped; artist's send goes **straight to the coach**.
> - **Otherwise** → rep reviews, then **Send to Coach** (recipients default-all + Select-All;
>   email/SMS via `portal-action`).

**4.1 — Coach reviews in the portal** (`CoachPortal` via `alpha_tag`): opens the job card, sees
mockups + specs.

> **◆ D6a — Coach decision.**
> - **✅ Approve Artwork** → `art_status → production_files_needed` (or `art_complete`),
>   `so_art_files.status → approved`, `coach_approved_at` stamped; rep emailed.
> - **❌ Request Changes** (feedback required) → `art_status → art_requested`, `coach_rejected =
>   true`, appended to `rejections[]`; art file `→ waiting_for_art`; rep emailed. Loops back to 3.2.

**Safety rails (SO-1199):** moving forward over a live rejection requires confirmation and clears
the stranded flag; the order's Jobs tab keeps the mockup + coach feedback visible after a
change-request. With #1397, approval/forward mutations now use a **result-checked save**
(`onSaveNow`) so a failed write reports failure instead of silently "succeeding."

---

## Phase 5 — Fulfillment branch (the only place inside & outside diverge)

> **◆ D8 — Decided by the deco PO (`deco_po_id`) / the routing flag.**

**IN-HOUSE** (`fulfillment = null`, no PO):
- The job sits in its production-files stage after approval: screen-print waits for confirmed seps;
  **embroidery auto-completes on a `.dst`**; DTF/heat-press → "Order DTF Transfers". #1397's
  **auto-answered prod-file gate** lands `art_complete` without an extra modal when the prod file is
  detectable.
- Then production: Hold → Ready → Staging → In Process → Completed → Shipped.

**OUTSIDE** (`fulfillment = 'outside'` and/or `deco_po_id` set):
- **Apply the real art** when the vendor returns the digitized file (onto the `ART TBD` row, or pick
  an existing design). The mockup still goes through **◆ D6 approval** so the customer signs off —
  but because the deco is routed outside, **applying art does NOT create a job** (the gate skips it).
  *Approval without a job — the thing that was impossible before.*
- **Bundle into a deco PO** (per vendor; multi-item). The PO stamps each covered deco with
  `deco_po_id`, sets cost-of-record, and (via #1226) defaults the **blanks' Ship-To to the
  decorator's structured address** on drop-ship. Tracked Waiting → Ordered → Received; bill →
  `_bill_cost`.

---

## The branch decision tree (consolidated)

```
 ◆D1 design?      existing(design_id)──▶ may be already approved ──▶ ◆D5 reuse → skip approval
                  New Art TBD ──────────▶ artist workflow
                  Art TBD (pricing) ────▶ number only, no workflow
 ◆D2 type/complexity/placement ─────────▶ sets price (same in/out)
 ◆D3 routing      In-house (default) ───▶ builds a job
                  Outside (soft flag) ──▶ ◆D4 vendor+cost ─▶ no job
 ◆D5 reuse approved mock? ──────────────▶ already-approved (skip coach) | send to coach
 ◆D6 send for approval ─────────────────▶ waiting_approval
 ◆D7 rep gate     trusted customer ─────▶ straight to coach
                  otherwise ────────────▶ rep reviews → coach
 ◆D6a coach ──────────────────────────── approve | request changes(loop)
 ◆D8 fulfillment  in-house ─────────────▶ prod files → art_complete → production
                  outside (deco_po_id) ─▶ apply art (approval, no job) + deco PO
```

Inside vs outside share **D1, D2, D5, D6, D6a, D7** — the entire design + approval spine. They
differ **only** at **D3/D4/D8** (routing & fulfillment).

---

## State / badge reference

| Routing | `fulfillment` | `deco_po_id` | Border | Job? | Approval? | Cost |
|---|---|---|---|---|---|---|
| In-house | null | — | blue | yes | yes | in-house tables |
| Outside (flagged) | `'outside'` | — | purple · **needs PO** | no | yes | none yet |
| Outside (PO'd) | `'outside'` | set | purple · on DPO | no | yes | the deco PO |

---

## What's already in PR #1422 vs. still to build

**Already merged into #1422:**
- **Phase 1 gate** — unified `isDecoOutsourced` so jobs **and** costs agree (no double-count).
- **#1397** — `design_id` reuse, persisted `mock_links`, `preview_url` gate, `onSaveNow`
  result-checked save, approval-simplification groundwork + the workflow map/recommendations docs.
- **#1226** — deco-PO cost slots + Linked-Documents deco section + decorator Ship-To (rewired onto
  main's **structured** vendor address).

**Still to build (Phase 2/3 — the visible part):**
- Migration `00153`: `fulfillment` + `deco_po_id` columns; extend the gate to honor the soft flag.
- The unified card **In-house | Outside** toggle, **multi-select "Mark Outside,"** and
  **"Create Deco PO for N outside items"** bundling.
- Wire **◆ D5/D7** simplifications (reuse-skips-approval, per-customer rep-gate skip) end-to-end.
- Outside lane on the Jobs tab; conversion "N outside decorations need a PO" check; mobile parity.
```
