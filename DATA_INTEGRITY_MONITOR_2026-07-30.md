# Data Integrity Monitor — baseline & findings (2026-07-30)

## Why this exists

The recurring pattern in this codebase: an incident happens → a bespoke client-side
guard is added → a new failure mode falls through the gap *between* guards → repeat
(see `ORDERS_DATA_LOSS_INVESTIGATION_2026-07-27.md`, `SAVE_PATH_AUDIT_2026-07-16.md`,
the EST-1119/EST-1316/SO-1514 guard comments in `src/lib/dbEngine.js`). The missing
piece is *detection*: bad data currently surfaces when a rep happens to notice a $0
screen, weeks later, after the audit trail has aged out.

This monitor closes that gap. `scripts/data_integrity_monitor.sql` is a read-only
sweep of ~22 invariants over the money/persistence tables. Run it any time; compare
against the baseline below. **A count above baseline = something broke recently**
— triage the same day, while `est_history` / `so_history` / `estimate_items_audit`
/ `stale_save_log` still cover the window.

## How to run

Paste `scripts/data_integrity_monitor.sql` into the Supabase SQL editor (or run via
MCP `execute_sql`). It is strictly read-only. A scheduled Claude Routine ("NSA data
integrity monitor") runs it daily and reports only when a count exceeds baseline.

## Baseline (first sweep, 2026-07-30)

| check | count | status |
|---|---|---|
| `est_item_priced_zero_qty` | 27 | ⚠ backlog — see Finding 2 |
| `so_item_priced_zero_qty` | 10 | ⚠ backlog — see Finding 2 (8 SOs, several in `need_order`/`needs_pull`) |
| `est_open_zero_items` | 1 | known — EST-1639, kept deliberately pending rebuild (see `ORDER_ID_COLLISION_INVESTIGATION`-style note below) |
| `so_zero_items` | 0 | clean after excluding `SO-0DEMO1/2/3` (webstore demo rows) |
| `so_dup_bill_shipment` | 1 | known — SO-1140 IQ2728, the one tangled duplicate held for manual reconcile (see Finding 3) |
| all 18 other checks (orphans, dup indexes, dangling customer/SO/estimate/invoice refs) | 0 | ✅ clean |

**Headline: referential integrity is fully clean.** Zero orphaned children, zero
duplicate `(doc, item_index)` pairs, zero dangling references across estimates,
SOs, invoices, webstores, and POs. The guard work to date has held the structural
layer. The open issues are data-*quality* (zero-qty priced lines), not corruption.

## Finding 1 — empty "open" estimates (resolved 2026-07-30)

Six open estimates had zero line items (EST-1352, EST-1502, EST-1639, EST-1709,
EST-1747, EST-1784). Proven **not** data loss: no `estimate_items_audit` rows, no
`est_history` snapshots (i.e. exactly one DB write ever), no `stale_save_log`
entries, `_version` = 1 on all six.

Root cause: `OrderEditor`'s unconditional flush paths (30 s autosave, `beforeunload`,
`nsa:version-reload-pending` — `src/OrderEditor.js:1375-1391`) persist a brand-new
draft **before any item is added**, and `savE` (`src/App.js:5913`) promotes
`draft → open` on that save. Every dbEngine guard protects *existing DB items*;
none covers the brand-new-and-itemless case.

Action taken: 5 soft-deleted (restorable via `deleted_at = NULL`); EST-1639 kept,
awaiting line items from Steve. **Not yet fixed in code** — until it is, this class
will recur; the `est_open_zero_items` check catches each new one within a day.

## Finding 2 — priced lines with zero quantity (open, needs rep triage)

27 estimate lines + 10 SO lines carry a sell price but zero units (empty `sizes`,
no `est_qty`, not `qty_only`). History snapshots show all-but-one were **zero in
every snapshot** — placeholder lines never filled in, not wiped quantities. The
exception: EST-1441 / JX4452 (Pregame Tee) had qty 1 in one snapshot, later 0,
and carried into SO-1439 at $0.

Why it matters: on an **active** SO (`need_order`, `needs_pull`) such a line bills
$0 and orders nothing. If the rep intended units, that's silent revenue/fulfillment
leakage. Flagged SOs at baseline: SO-1055, SO-1439, SO-1514, SO-1592, SO-1670
(complete), SO-1681, SO-1684.

Recommended: reps confirm each active-SO line (fill sizes or delete the line);
longer-term, the app should warn on save/convert when a priced line has no units.

## Finding 3 — duplicate billing (repaired 2026-07-30; guard + monitor added)

A SportsInc re-import on 2026-07-27 applied vendor invoices a **second time** under
SportsInc's own document numbers (different doc #, but identical tracking # + sizes +
cost as the native invoice already applied). Because the second application pushed
billed past ordered and the overage was accepted, it also **doubled the ordered
quantities** on the affected lines — which is what surfaced as "received shows half"
(SO-1522 NEA200, SO-1159, and 26 more).

- **Data repaired:** 28 SOs / 57 lines de-duplicated, ~$9,260 of phantom cost removed,
  `received` never touched. One line (SO-1140 IQ2728) held for manual reconcile — it is
  the single remaining `so_dup_bill_shipment` violation.
- **Guard added (recurrence prevention):** `duplicateBillDetail` in
  `src/lib/billAnomalies.js`, wired into both wizard bill-apply paths
  (`_applyBillByMappings` so_po and `_applyBillToBatchSOs`). A bill line whose
  (tracking #, sizes) — or (doc #, sizes) — is already on a PO line is **skipped, not
  re-billed**, and the rep is notified. Requiring the size breakdown to match keeps
  legitimate split-billing of one shipment across invoices from being blocked.
- **Detection added:** the `so_dup_bill_shipment` invariant above.
- **Still open (accounting):** the duplicates were `pushed` to QuickBooks as separate
  bills, so the real-money double-payment is unwound on the QB/SportsInc side separately.

## The road to "data is solid" (agreed direction)

1. **Monitor first** (this document) — read-only, no behavior change. ✅ live
2. **DB constraints, one at a time**, each landed only after the monitor shows zero
   violations for it (e.g. FKs for the orphan classes — already clean, so cheap to
   lock in; server-side ID minting to kill the collision class).
3. **One write path per entity** — consolidate the estimate save fan-in (foreground /
   autosave / beforeunload / deploy-flush / bg diff-sync) behind the RPC; retire
   client guards the constraints make redundant.
4. **Unify estimate/SO save paths** — same shape, two hand-synced copies today
   (flagged in `FABLE_SYSTEM_AUDIT_2026-07-03.md`).

Rule of thumb going forward: when an incident happens, don't add guard #23 — name
the invariant, enforce it in the database, add it to this monitor, and delete the
client guards it obsoletes.
