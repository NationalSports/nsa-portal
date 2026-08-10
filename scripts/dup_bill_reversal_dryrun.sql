-- ============================================================================
-- NSA Portal — duplicate supplier-bill reversal: DRY RUN (read-only)
-- ============================================================================
-- Companion to the `so_dup_bill_shipment` invariant in data_integrity_monitor.sql.
-- That invariant COUNTS double-billed PO lines; this script builds the correction
-- plan for them and, crucially, flags the ones a script must NOT touch unattended.
--
-- Cause (fixed for new bills in the SO-1468 PR): `_applyFreightToSOs` in App.js
-- appended to a PO line's `billed` and `_bill_details` without the
-- `duplicateBillDetail` check its two sibling apply paths already had, so one
-- bill landing twice doubled the line.
--
-- Baseline at time of writing (2026-08-10): 129 duplicate entries, 117 PO lines,
-- 43 orders, $22,876.88 of duplicated vendor cost. That cost feeds the order cost
-- rollup (App.js soCost), so job costing and margin are overstated wherever it lands.
-- It does NOT flow to AP — vendor payment runs through QuickBooks bills.
--
-- READ-ONLY. Nothing here writes. §4 is the plan a reviewed apply step would follow.
-- ============================================================================

-- Shared: every _bill_details entry, with its duplicate rank inside its PO line.
-- A duplicate group = same PO line + same (tracking, else doc) + identical size
-- breakdown. Requiring sizes to match keeps legitimate split-billing of one
-- shipment across separate invoices out of the plan (see duplicateBillDetail).
CREATE OR REPLACE TEMP VIEW _dup_extras AS
WITH details AS (
  SELECT pl.id AS line_id, i.so_id, i.sku, pl.po_id, pl.billed, pl.sizes AS szrow,
         d.ord, d.val,
         COALESCE(NULLIF(d.val->>'tracking',''), d.val->>'doc') AS key,
         d.val->'sizes' AS sz,
         (d.val->>'cost')::numeric AS cost
  FROM so_item_po_lines pl
  JOIN so_items i ON i.id = pl.so_item_id
  JOIN sales_orders s ON s.id = i.so_id AND s.deleted_at IS NULL AND s.id NOT LIKE 'SO-0DEMO%',
  LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(pl.sizes->'_bill_details')='array' THEN pl.sizes->'_bill_details' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS d(val, ord)
  WHERE COALESCE(NULLIF(d.val->>'tracking',''), d.val->>'doc') IS NOT NULL
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY line_id, key, sz ORDER BY ord) AS rn
  FROM details
)
-- rn=1 is the entry that stays; everything above it is a duplicate to reverse.
SELECT * FROM ranked WHERE rn > 1;

-- ── §1 Totals ───────────────────────────────────────────────────────────────
SELECT 'entries_to_remove' AS metric, COUNT(*)::text AS value FROM _dup_extras
UNION ALL SELECT 'po_lines',    COUNT(DISTINCT line_id)::text FROM _dup_extras
UNION ALL SELECT 'orders',      COUNT(DISTINCT so_id)::text   FROM _dup_extras
UNION ALL SELECT 'cost_to_reverse', ROUND(SUM(cost),2)::text  FROM _dup_extras
-- Sanity: a credit (negative cost) or a sizeless entry would mean this plan is
-- reversing something it does not understand. Both are expected to be 0.
UNION ALL SELECT 'sanity_negative_cost', COUNT(*)::text FROM _dup_extras WHERE cost < 0
UNION ALL SELECT 'sanity_missing_cost',  COUNT(*)::text FROM _dup_extras WHERE cost IS NULL
UNION ALL SELECT 'sanity_no_sizes',      COUNT(*)::text FROM _dup_extras WHERE sz IS NULL OR jsonb_typeof(sz)<>'object';

-- ── §2 Lines needing a human before any write ───────────────────────────────
-- The apply path aligns a bill's size key to the PO line's own keys via
-- _alignSize/_canonBillSize in App.js ('S 3"'→'S', 'LARGE'→'L', '7-'→'7½').
-- Those are ~40 lines of JS regex heuristics. A reversal that subtracts the RAW
-- key silently no-ops on these lines: it would strip the cost while leaving the
-- inflated `billed` in place. Do NOT batch these — resolve the mapping per line.
-- SO-1720 is the sharp case: its line carries BOTH whole and half sizes, so
-- '7-' must resolve to 7.5 and not 7.
SELECT x.so_id, x.sku, x.po_id, x.billed AS billed_now,
       x.sz AS extra_sizes_to_remove, x.cost
FROM _dup_extras x
WHERE EXISTS (
  SELECT 1 FROM jsonb_each_text(x.sz) e(key,qty) WHERE NOT (x.billed ? e.key)
)
ORDER BY x.cost DESC;

-- ── §3 Per-order rollup ─────────────────────────────────────────────────────
WITH per_line AS (
  SELECT line_id, MAX(so_id) so_id, SUM(cost) cost,
         bool_or(EXISTS (SELECT 1 FROM jsonb_each_text(x.sz) e(key,qty) WHERE NOT (x.billed ? e.key))) needs_review
  FROM _dup_extras x GROUP BY line_id
)
SELECT so_id, COUNT(*) AS po_lines,
       COUNT(*) FILTER (WHERE needs_review) AS lines_needing_review,
       ROUND(SUM(cost),2) AS cost_to_reverse
FROM per_line GROUP BY so_id ORDER BY cost_to_reverse DESC;

-- ── §4 The plan, per line ───────────────────────────────────────────────────
-- What a reviewed apply step would do for each line NOT flagged in §2:
--   billed[size] -= (duplicate qty)      _bill_cost -= (duplicate cost)
--   and drop the duplicate _bill_details entries (keep rn=1).
-- Prefer recording the correction the way the in-app reversal already does
-- (App.js ~26574: a negative _bill_details entry, billed comes down) so the
-- change stays auditable instead of being edited away silently.
-- `billed_after` landing exactly on `ordered` is the confirmation to look for.
WITH delta AS (
  SELECT line_id, e.key AS szk, SUM(e.qty::numeric) AS dq
  FROM _dup_extras, LATERAL jsonb_each_text(sz) e(key,qty) GROUP BY 1,2
), per_line AS (
  SELECT line_id, MAX(so_id) so_id, MAX(sku) sku, MAX(po_id) po_id,
         MAX(billed::text)::jsonb billed, MAX(szrow::text)::jsonb szrow, SUM(cost) cost_removed
  FROM _dup_extras GROUP BY line_id
)
SELECT p.so_id, p.sku, p.po_id, p.billed AS billed_now,
       (SELECT jsonb_object_agg(d.szk,d.dq) FROM delta d WHERE d.line_id=p.line_id) AS subtract,
       (SELECT jsonb_object_agg(k,v) FROM (
          SELECT k, (p.billed->>k)::numeric
                    - COALESCE((SELECT dq FROM delta d WHERE d.line_id=p.line_id AND d.szk=k),0) v
          FROM jsonb_object_keys(p.billed) k) z) AS billed_after,
       (SELECT jsonb_object_agg(k,v) FROM (
          SELECT k, (p.szrow->>k)::numeric v FROM jsonb_object_keys(p.szrow) k
          WHERE k !~ '^_' AND k <> 'unit_cost' AND jsonb_typeof(p.szrow->k)='number') o) AS ordered,
       p.cost_removed
FROM per_line p ORDER BY p.cost_removed DESC;
