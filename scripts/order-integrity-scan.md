# Order-integrity scan — the correctness oracle (read-only)

`order-integrity-scan.sql` is a **read-only** set of checks that verify the
invariants the order system is *supposed* to uphold. Its job is to surface
misfiled or lost order data (a deco PO on the wrong customer's order, a
decoration that fell off during conversion, duplicate line rows from an
interrupted save) **in minutes**, instead of weeks later as a one-off
"recover-po-XXXX" cleanup.

This is the first piece of the larger plan to make sales-order saves provably
correct (see "Roadmap" below). It needs no application code and no live writes,
so it can run today against production read-only.

## How to run

Paste **Section 1** (the summary) into the Supabase SQL editor / MCP, or
`psql`. It returns one row of violation counts. For any non-zero count, run the
matching drill-down from **Section 2**.

> Run it against **production read-only**, or a Supabase branch seeded from
> prod. It only ever `SELECT`s. Confirm which environment you're pointed at
> before acting on any finding.

## What it checks

| Check | Class | Meaning |
|---|---|---|
| `orphan_*` | HARD | A child row (item / decoration / pick / PO / job / art / invoice line) whose parent doesn't exist. Always a bug. |
| `dup_item_index`, `dup_deco_index` | HARD | Two rows sharing the same logical key on one order — the transient-duplicate risk from the **non-transactional SO save**. |
| `deco_art_not_on_same_so`, `job_art_not_on_same_so` | HARD | A decoration/job points at an art file that belongs to a different order (cross-order bleed) or no longer exists (dangling). "Art stays tied to its order." |
| `decopo_bad_item_idx` | HARD | A deco PO references item indexes that don't exist on its SO. |
| `decopo_qty_smell` | SOFT | A deco PO whose quantity is far larger than the units on the line(s) it covers — the **PO-3077 pattern**. A smell, not proof; tune the threshold. |
| `invoice_total_mismatch` | SOFT | An invoice header total that doesn't reconcile to its own line items + shipping + tax (allowing the CC surcharge). |
| `invoice_items_null_money` | HARD-ish | Rows in `invoice_items` with null `total`/`unit_price` (the app writes the wrong field names; `invoices.line_items` jsonb is authoritative — see below). |

### The `est_qty` fallback (read this before tuning quantity checks)

"Qty-only / custom" lines store their count in `so_items.est_qty` with an
**empty `sizes` map**. Any quantity check must fall back to `est_qty` when the
size grid is empty. A detection query that summed only `sizes` is exactly what
once flagged a correct 47-piece deco PO (covering two 24-unit qty-only lines) as
"covering 0 units." Every quantity check in the scan already does this; preserve
it in anything you add.

## Baseline results (first run, against live data)

Run on the current dataset (255 SOs / 1,015 items / 853 PO lines / 88 invoices):

- **Referential integrity: clean.** Zero orphans across every child table — the
  existing (non-atomic) save path's guards are holding in practice.
- **`dup_item_index`: 3** — `SO-1106` (item 0) and `SO-1248` (items 0, 1) each
  carry a duplicated line row. Low rate, but it's the non-atomic-save duplicate
  risk *materialized* in real data. Worth a manual de-dupe + the eventual
  transactional save.
- **`deco_art_not_on_same_so`: 1** (`SO-1049`, dangling — art `af1773594072417`
  no longer exists) and **`job_art_not_on_same_so`: 26** (all dangling — jobs
  referencing art ids that were deleted/replaced and not re-pointed). Cosmetic
  vs. real depends on whether those jobs still need their art linked.
- **`decopo_qty_smell`: 1 confirmed worth review** — `SO-1144` / `DPO 3144`
  (qty 144 covering ~30 tees, notes reference a different org). Needs the same
  forensic trace PO-3077 got before any move. By contrast `SO-1089` / `PO 3078`
  (qty 47 over two 24-unit qty-only lines) correctly **passes** — that's the
  est_qty fallback earning its keep.
- **`invoice_total_mismatch`: 0** — all 88 invoices reconcile once the CC
  surcharge is included.
- **`invoice_items_null_money`: every row (202 at last scan)** — all of
  `invoice_items` has null `total`/`unit_price`. The invoice builder populates `{sku,name,qty,unit_sell}`
  but the insert reads `{unit_price,total,description}`, so those columns are
  never written. **Do not read `invoice_items` for money** — `invoices.line_items`
  (jsonb) is authoritative. Cheap fix: align the field names (or stop writing the
  table).

## Known root-cause bugs this scan is the safety net for

1. **Deco PO can attach to the wrong / quantity-mismatched SO** with no guard, so
   a 100-piece print can land on a 4-piece order (`OrderEditor.js` deco-PO create,
   ~6459/6510). The DB already has a sibling guard pattern
   (`enforce_so_estimate_customer` trigger) that this could mirror.
2. **Decorations can fail to persist through estimate→SO conversion.** `convertSO`
   (`App.js:6354`) deep-clones items+decorations and copies art, so the *intent*
   is to carry them — yet converted SOs are observed missing the
   `so_item_decorations` row. The exact failure point (how a freshly-converted
   SO persists nested decorations) is still under investigation; **do not patch
   the conversion path until it's understood** — it's the most load-bearing write
   path in the app.

## Roadmap (this file is step 1)

1. **Invariant scan (this file)** — read-only, runs against prod today.
2. **Schedule it** — a daily/hourly job that runs Section 1 and *alerts loudly*
   on any HARD violation (and includes a heartbeat: "ran, scanned N orders," so a
   silent green isn't a dead job).
3. **Capture + replay (shadow)** — passively log each SO save's inputs, replay
   them through a future transactional `save_sales_order` RPC on a Supabase
   branch, and diff the result against the live path. The invariants here become
   the oracle the RPC must satisfy before any cutover.
4. **Derived-financial checks** — assert invoice / commission / status numbers
   using the **production** modules (`pricing.js`, `components.js`), not the
   drifted `businessLogic.js` mirror. (Folds in the "tests validate the copy, not
   production" cleanup.)

> Note on payments: `invoice_payments` is empty and only ~5/88 invoices show as
> paid in-app — QuickBooks (`qb_invoice_id`) is the system of record for
> payments. Do **not** assert `paid == Σ payment rows`; reconcile against QB
> instead. This also means in-app commission/collections figures run on sparse
> data — confirm whether commissions are computed from the portal or from QB.
