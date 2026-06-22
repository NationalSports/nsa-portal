# Warehouse Box Tracking — Basic Plan (BX license plates)

Status: **design approved, build pending** (to be implemented in its own PR).
Companion to the 4×6 label / QR-scan work merged in PR #1332.

## Problem / current state

Today the system tracks **IF pick lines** (per-IF, per-item sizes + ship
destination — the IF's *total* pulled quantity) and **shipments**
(`so._shipments`, box contents captured only when a carrier label is bought).
The boxes built in the ship step are **ephemeral UI state** (`whViewIF._boxes`),
never persisted. The printed QR encodes the **IF#/PO#/SO#**, not a box, and
scanning simply navigates to that record.

There is **no box entity**, so the system cannot answer "IF-1071 is split across
2 boxes with these exact SKUs/sizes," and scanning a box offers **no actions**.

## Decision: global `BX-####` license plates

A box is a physical container whose **contents change** (combine, add, send to
deco). An id that encodes contents (`IF-1071-1`) becomes wrong the moment a box
mixes IFs and forces the id to change on every merge. So each box gets an opaque
**`BX-####` plate**; the human context (team name, IF#, SO#) is printed large on
the label. The QR encodes the plate; the meta line reads e.g.
`BX-2001 · IF-1071 · PULLED — 6/16`.

## Data model — new `boxes` table (Supabase)

```
boxes(
  id            text PK,         -- 'BX-2001'
  kind          text,            -- 'fulfillment' | 'receiving' | 'consolidation'
  contents      jsonb,           -- [ {sku,name,color, so_id, if_id, sizes:{S:3,M:2}} ]
  source_refs   jsonb,           -- [ {type:'IF',id:'IF-1071'}, {type:'PO',id:'NSA-4501'} ]
  so_id         text,            -- convenience refs (nullable)
  if_id         text,
  po_id         text,
  status        text,            -- 'staged' | 'at_deco' | 'shipped' | 'combined'
  merged_into   text,            -- surviving plate when this box was absorbed
  bin           text,            -- future bin location (nullable now)
  weight        numeric,
  dimensions    jsonb,
  created_by    text,
  created_at    timestamptz,
  updated_at    timestamptz
)
```

`contents` is the authoritative SKUs×sizes physically in the box.

## Lifecycle

- **Created at pull / receive**: the units pulled this round (or received in a
  carton) auto-create a box with those exact SKUs×sizes — this *is* what the
  printed label represents. Partial pulls → multiple boxes per IF, each its own
  plate.
- **status**: `staged` → (`at_deco` | `shipped`); `combined` when absorbed.

## Label / QR change

- QR encodes the **box plate** (`?scan=BX-2001`).
- Meta line: `BX-2001 · IF-1071 · PULLED — date`. Team/SO#/items unchanged from
  the merged label design.
- Stale labels (QR = IF#) still resolve: scanning an IF# with multiple boxes
  lists them to pick; retired plates redirect via `merged_into`.

## Scan → Box Action popup

`handleScanResult` detects a `BX-` id and opens a **Box Action modal** (phone /
tablet / desktop) showing contents + context-aware actions, in this order:

1. **➡️ Take to Decoration** — shown **first, only when** the box's items are
   deco-ready (art approved + items in). Sets `status=at_deco`, advances the job.
2. **🔗 Combine with another box** — scan/pick a 2nd box → **sum SKUs+sizes** →
   write merged box, mark absorbed box(es) `combined` + `merged_into`, **reprint
   one label**.
3. **➕ Add just-checked-in items** — fold the latest pull/receive into this box
   → sum → reprint.

## Reconciliation (inventory payoff)

Sum of a given IF's box `contents` must equal the IF's pulled qty; surface a flag
on leak/double-count. "Where is IF-1071?" → lists its boxes with status and
(later) bin.

## Bin-readiness (next phase)

Add a `bin` to a box, a "scan bin → place box here" action, and a "what's in bin
A3" view. No rework — the box record already carries the slot.

## Phasing / rough effort

- **Phase 1 (this feature):** `boxes` table + store wiring (S); box auto-create
  at pull/receive (S); label QR→plate (S); scan-action modal (M); combine/add +
  reprint + redirect (M); reconciliation flag (S).
- **Phase 2 (later):** bin locations (place/scan bin, "what's in bin" view).

A detailed, file-by-file implementation plan (migration SQL, component/state
design, function signatures, edge cases, test plan, rollout) follows once this
basic plan is merged.
