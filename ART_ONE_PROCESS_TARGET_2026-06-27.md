# Art — One Process (Target Architecture)

**Date:** 2026-06-27 · The north-star for PR #1422. Collapses the **three stacked art systems**
into one. Supersedes the framing in the prior specs (audit, click ledger, unified-flow,
estimate→approval, CW web-logo) — those remain valid as detail; this is the single end state they
all feed.

> **Principle:** there is **one** art object (a *design*), it has **one** lifecycle status, its
> images resolve through **one** function, and *how it's made* (in-house vs. outside) is a **flag**,
> not a different object. Everything reads the same source of truth; nothing is hand-synced.

---

## The three systems today → the one process

| Layer | Stacked today | One process |
|---|---|---|
| **1 · What's decorated** | `kind:'art'` (priced, art file, approval, library) **vs** `kind:'outside_deco'` (flat cost, no art file/approval/library) + a separate SO-level deco PO | **One decoration** = design + **routing flag**. `kind:'art'` always; legacy `outside_deco` reads as art + `fulfillment:'outside'`. |
| **2 · Approval status** | `so_jobs.art_status` **and** `so_art_files.status`, hand-synced every step (SO-1199 bug class) | **One canonical status on the art file**; the job's `art_status` is **derived** from its art files (worst-of), never authored. |
| **3 · Images & reuse** | `preview_url` / `web_logo_url` / `web_logos[]` / `item_mockups` / `mockup_files` / `mock_links`, keyed on name / `design_id` / CW label / `color_way_id` | **One asset model** keyed on **`(design_id, color_way_id)`**, read through **one resolver** `pickCwAsset`. |

---

## Layer 1 — one decoration, routing is a flag

- A decoration is always `kind:'art'` (or `numbers`/`names`) carrying: placement, deco type, the
  design (`art_file_id` / `design_id`), customer sell price.
- **Fulfillment is a flag**, not a second object:
  - `fulfillment` = `null` (in-house, default) | `'outside'` (soft flag, per-card or bulk).
  - `deco_po_id` = set when bundled onto a deco PO (commits cost; vendor produces it).
- **One gate, read by jobs *and* costs** — `isDecoOutsourced(o,i,d)` → `deco_po_id || fulfillment==='outside' || legacy outside_deco`. ✅ **already built (Phase 1, in #1422).**
- Legacy `kind:'outside_deco'` rows render through the same card (mapped to art + `outside` on read) — no data migration, no second UI.

## Layer 2 — one status (art file canonical, job derived)

- **Canonical:** `so_art_files.status` ∈ `needs_art → waiting_for_art → needs_approval → approved`.
- **Derived:** `so_jobs.art_status` is computed from the job's referenced art files (the worst
  status across them) — exactly what `buildJobs`/`syncJobs` *already* compute as `worstArtSt`. We
  make that the **only** writer; nothing sets `art_status` independently.
- Kills the hand-sync and the SO-1199 "forward-clobbers-a-rejection" class: there's nothing to
  strand because there's one source.
- Coach/rep actions write the **art file** status (+ `coach_rejected`/`rejections[]` on the
  design); the board re-derives. `onSaveNow` (from #1397, merged) makes those writes result-checked.

## Layer 3 — one asset model + one resolver

**Data (target shape):**
- `art_files[].design_id` — stable cross-order identity. ✅ **merged (#1397).**
- `art_files[].web_logos[] = [{ url, color_way_id, color_way?, is_default? }]` — per-CW web logo,
  keyed on **`color_way_id`**. Legacy `web_logo_url` = the default entry; `preview_url` = final
  fallback.
- mocks (`item_mockups` / `mockup_files`) tagged with **`color_way_id`** (#942's intent).
- `color_ways[].color_way_id` — the stable CW identity decorations already reference
  (`color_way_id` / `color_way_id_b`).

**One resolver** (replaces every ad-hoc chain in `Webstores.js` / `OrderEditor.js` / `CoachPortal.js`):

```
pickCwAsset(art, colorWayId, kind /* 'web_logo' | 'mock' */) -> url | null
  web_logo: web_logos.find(color_way_id === colorWayId)?.url
            || web_logos.find(is_default / blank)?.url
            || web_logo_url || preview_url || null
  mock:     mocks tagged color_way_id === colorWayId
            || per-sku mock || untagged general mock || null
```

- **Reuse across orders:** `priorMocks` keyed on `design_id` (#1397) surfaces a design's prior
  approved assets; `pickCwAsset` then selects the right CW. This is the coach-portal "apply art →
  see old artwork on the color card you pick."
- **Approval gate (Decision 1):** a design may go for approval only when **every used
  `color_way_id` has a web logo** (a `web_logos` entry or the default); `preview_url` is the
  fallback, not the requirement.
- **Keying (Decision 2):** web logos **and** mocks both key on `color_way_id` — never the label
  string. One scheme.

---

## What's already in place (in #1422) vs. to build

| Piece | Status |
|---|---|
| Layer 1 gate (`isDecoOutsourced`, jobs+costs agree) | ✅ merged (Phase 1) |
| `design_id` + `priorMocks` reuse, `mock_links`, `onSaveNow` | ✅ merged (#1397) |
| Decorator ship-to, deco-PO cost visibility | ✅ integrated (#1226) |
| Decisions 1 & 2 (per-CW gate, `color_way_id` keying) | ✅ locked (decision record) |
| `pickCwAsset` single resolver | ⛔ build |
| `web_logos[]` + mock tags re-keyed to `color_way_id` (+ label backfill) | ⛔ build |
| `fulfillment` / `deco_po_id` columns + soft-flag UI + bulk "Mark Outside" + PO bundling | ⛔ build |
| Status collapse (art file canonical, job derived) | ⛔ build |

**Nothing from #942/#1397/#1226 is lost** — their intents are captured here as properties of the
one model rather than grafted layers.

---

## Build order (on current `main`, not by merging old PRs)

1. **B1 — `pickCwAsset` resolver (pure, testable).** One function for web logo + mock keyed on
   `(design_id, color_way_id)`; unit tests for the fallback chain. Wire `Webstores`/`OrderEditor`/
   `CoachPortal` reads to it. *Additive, no behavior change for existing data → safest first.*
   Delivers the coach-portal "old artwork on selected color" directly.
2. **B2 — Re-key assets to `color_way_id`.** Uploader stamps `color_way_id` on `web_logos[]`;
   backfill legacy entries by label match; align mock tags. Add the per-CW approval gate (Decision 1).
3. **B3 — Routing columns + soft-flag UI.** Migration `00153` (`fulfillment`, `deco_po_id`); extend
   the gate to honor the flag; unified card toggle + multi-select "Mark Outside" + "Create Deco PO
   for N items" bundling.
4. **B4 — Status collapse.** Make the art file status canonical and the job `art_status` strictly
   derived; remove independent writers.

**Recommended start: B1** — pure, testable, no migration, and it's the piece that makes
"apply art → see old artwork on the color you pick" real.
