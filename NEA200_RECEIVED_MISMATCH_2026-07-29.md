# SO-1522 NEA200 "30/51 Rcvd" Mismatch — Investigation & Repair (2026-07-29)

## What was reported

On SO-1522 (Crean Lutheran HSA), the Jobs view showed NEA200 True Navy fully
received (30/30, correct — the goods are all here), but the Sales Order line-items
view showed PO 13050 CLHSA at **30/51 Rcvd** with ordered sizes 12/12/17/6/4.

## Root cause

SanMar bill **162348107** (SI doc 24631569, $3,102.54, applied 2026-07-27 via the
bill wizard) billed the PO 100% complete and correct — every colorway its own line,
correct prices. The damage happened at apply time:

- **6 bill lines were billed onto the wrong SO line.** NEA200 *Rainstorm Grey*
  S/XL/2XL, LNEA101 *Shadow Grey* S/M, and JST488 L (at $21.72 — the source of the
  "sharp_price NEA200 $10.46 → $21.72" flag) all landed on the **NEA200 True Navy**
  po_line: 30 own units + 21 misdirected = 51 billed (S12/M12/L17/XL6/2XL4 exactly).
- Because the flagged **overage was accepted** on apply, `_applyBillByMappings`'s
  qty-fix then raised the line's *ordered* quantities to the billed total
  (30 → 51, audited in `_qty_corrections`). Received stayed at the correct 30,
  so the SO chip showed 30/51 partial forever — 21 phantom units that never existed.
- **11 bill lines were dropped entirely** (NEA200-RG M/L, JST488 S/M, NEA201 M/L,
  NEA225 S/M, LNEA225 S/M, LNEA101-Shadow XS). Those po_lines were left with empty
  or partial `billed`, and the SO carried only $2,038.40 of the bill's $3,077.92
  merchandise — understating order cost (and commission margin) by ~$1,040.

### Why the wizard fumbled these specific lines

SanMar truncates colors to ~5 chars on the bill ("TrueN", "Rains", "Shado").
`_matchLineToItems`' color narrowing compared normalized-with-spaces strings, so
`"TRUE NAVY".includes("TRUEN")` was **false** (the space breaks the substring),
while `"TRUENAVY"` (Sport-Tek's spelling) matched fine. Result: every two-colorway
New Era style came up ambiguous → "(verify)" → manual hand-assignment in the
wizard, where the 6 misdirects and 11 drops happened. All Sport-Tek lines
(colors without spaces) applied cleanly — exactly the observed pattern.

## What was fixed

### 1. Data repair (applied directly to `so_item_po_lines`, 2026-07-29)

Reconciled all 11 po_lines on PO 13050 CLHSA to the bill document (which matches
the original order exactly — the vendor shipped/billed everything ordered):

| line id | sku · color | ordered | billed before → after | _bill_cost before → after |
|---|---|---|---|---|
| 129877 | NEA200 · True Navy | **51 → 30** (reverted, `_qty_corrections` removed) | 51 → 30 | 827.28 → 313.70 |
| 129881 | NEA200 · Rainstorm Grey | 30 | 0 → 30 | — → 313.70 |
| 129882 | LNEA101 · Shadow Grey He | 5 | 0 → 5 | — → 36.30 |
| 129883 | NEA201 · Rainstorm Grey | 30 | 10 → 30 | 112.60 → 353.90 |
| 129885 | JST488 · TrueNavy | 27 | 0 → 27 | — → 586.44 |
| 129886 | NEA225 · TrueNavy | 27 | 7 → 27 | 109.48 → 422.28 |
| 129887 | LNEA225 · TrueNavy | 5 | 1 → 5 | 15.64 → 78.20 |
| 129878/79/80/84 | LNEA101-TN, ST485, LST484, PST485 | unchanged — were already correct | | |

Post-repair invariants, verified by query:
- Every line: ordered = received = billed (all "✓ Received").
- Σ `_bill_cost` = **$3,077.92** = the bill's merchandise total to the penny
  (the remaining $24.62 SI upcharge was already applied as `_inbound_freight`).
- `_bill_details` on each line now carries doc 162348107 with that line's own sizes.

The update ran in a guarded transaction (aborting if any row had drifted from its
inspected state); the full pre-repair row dump was captured first. Received
quantities and job data were never touched — they were correct throughout.

**Note:** anyone with SO-1522 open in a browser tab from before the repair should
refresh before saving — the app's delete-and-reinsert save would push the stale
pre-repair state back.

### 2. Code fix (`src/App.js`, `_matchLineToItems`)

Color narrowing now compares space-stripped colors, so truncated vendor colors
("TrueN") match spaced item colors ("True Navy") exactly instead of coming up
ambiguous. This removes the "(verify)" churn on two-colorway styles that caused
the manual mis-assignment.

## Residual risk / not fixed here

- The wizard still lets a manually assigned line bill any target, and the
  accepted-overage path (`_applyBillByMappings` qty-fix) will still rewrite
  ordered quantities to match a mis-assigned bill line. A guard worth considering
  later: warn when an overage correction would push a line's ordered above the
  SO item's total quantity for that size (here it went to 12 when the item runs 5).
- `applied_bills` history for doc 162348107 was left as-is (it records what
  happened, flags included).
