-- ============================================================================
-- NSA Portal — Data Integrity Monitor (read-only)
-- ============================================================================
-- Run this against production Supabase (SQL editor or MCP execute_sql).
-- Every row is an invariant the data should NEVER violate. Expected result:
-- all violation counts match the baseline in DATA_INTEGRITY_MONITOR_2026-07-30.md
-- (most are 0). A count ABOVE baseline means something broke recently — triage
-- the same day, while the audit trail (est_history / so_history /
-- estimate_items_audit / stale_save_log) still covers the window.
--
-- Design notes:
--  * Read-only: safe to run any time, any number of times.
--  * SO-0DEMO% rows are demo data for webstore showcase — excluded.
--  * "priced_zero_qty" = a non-qty-only line with a sell price but zero units
--    (sizes sum to 0 AND est_qty 0). On an ACTIVE doc this bills $0 and orders
--    nothing — either an intentional placeholder or silent revenue leakage.
-- ============================================================================
WITH size_sum_est AS (
  SELECT ei.id, COALESCE((SELECT SUM(CASE WHEN v.value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN v.value::numeric ELSE 0 END) FROM jsonb_each_text(COALESCE(ei.sizes,'{}'::jsonb)) v),0) AS total_qty
  FROM estimate_items ei
),
size_sum_so AS (
  SELECT si.id, COALESCE((SELECT SUM(CASE WHEN v.value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN v.value::numeric ELSE 0 END) FROM jsonb_each_text(COALESCE(si.sizes,'{}'::jsonb)) v),0) AS total_qty
  FROM so_items si
)
-- ── Estimates ───────────────────────────────────────────────────────────────
SELECT 'est_open_zero_items' AS check_name, COUNT(*) AS violations FROM estimates e
  WHERE e.deleted_at IS NULL AND e.status <> 'draft'
    AND NOT EXISTS (SELECT 1 FROM estimate_items i WHERE i.estimate_id=e.id)
UNION ALL
SELECT 'est_items_orphaned', COUNT(*) FROM estimate_items i
  WHERE NOT EXISTS (SELECT 1 FROM estimates e WHERE e.id=i.estimate_id)
UNION ALL
SELECT 'est_dup_item_index', COUNT(*) FROM (
  SELECT estimate_id,item_index FROM estimate_items GROUP BY estimate_id,item_index HAVING COUNT(*)>1) d
UNION ALL
SELECT 'est_decos_orphaned', COUNT(*) FROM estimate_item_decorations d
  WHERE NOT EXISTS (SELECT 1 FROM estimate_items i WHERE i.id=d.estimate_item_id)
UNION ALL
SELECT 'est_missing_customer', COUNT(*) FROM estimates e
  WHERE e.deleted_at IS NULL AND e.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=e.customer_id)
UNION ALL
SELECT 'est_item_priced_zero_qty', COUNT(*) FROM estimate_items ei
  JOIN estimates e ON e.id=ei.estimate_id AND e.deleted_at IS NULL
  JOIN size_sum_est ss ON ss.id=ei.id
  WHERE COALESCE(ei.qty_only,false)=false AND ss.total_qty=0 AND COALESCE(ei.est_qty,0)=0
    AND (COALESCE(ei.unit_sell,0)>0 OR COALESCE(ei.custom_sell,0)>0)
-- ── Sales orders ────────────────────────────────────────────────────────────
UNION ALL
SELECT 'so_zero_items', COUNT(*) FROM sales_orders s
  WHERE s.deleted_at IS NULL AND s.id NOT LIKE 'SO-0DEMO%'
    AND NOT EXISTS (SELECT 1 FROM so_items i WHERE i.so_id=s.id)
UNION ALL
SELECT 'so_items_orphaned', COUNT(*) FROM so_items i
  WHERE NOT EXISTS (SELECT 1 FROM sales_orders s WHERE s.id=i.so_id)
UNION ALL
SELECT 'so_dup_item_index', COUNT(*) FROM (
  SELECT so_id,item_index FROM so_items GROUP BY so_id,item_index HAVING COUNT(*)>1) d
UNION ALL
SELECT 'so_decos_orphaned', COUNT(*) FROM so_item_decorations d
  WHERE NOT EXISTS (SELECT 1 FROM so_items i WHERE i.id=d.so_item_id)
UNION ALL
SELECT 'so_missing_customer', COUNT(*) FROM sales_orders s
  WHERE s.deleted_at IS NULL AND s.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=s.customer_id)
UNION ALL
SELECT 'so_item_priced_zero_qty', COUNT(*) FROM so_items si
  JOIN sales_orders s ON s.id=si.so_id AND s.deleted_at IS NULL
  JOIN size_sum_so ss ON ss.id=si.id
  WHERE COALESCE(si.qty_only,false)=false AND ss.total_qty=0 AND COALESCE(si.est_qty,0)=0
    AND (COALESCE(si.unit_sell,0)>0 OR COALESCE(si.custom_sell,0)>0)
UNION ALL
SELECT 'so_jobs_orphaned', COUNT(*) FROM so_jobs j
  WHERE NOT EXISTS (SELECT 1 FROM sales_orders s WHERE s.id=j.so_id)
UNION ALL
SELECT 'so_art_reserved_tbd_id', COUNT(*) FROM so_art_files a
  WHERE a.id='__tbd'
UNION ALL
SELECT 'so_missing_estimate_ref', COUNT(*) FROM sales_orders s
  WHERE s.deleted_at IS NULL AND s.estimate_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM estimates e WHERE e.id=s.estimate_id)
-- ── Invoices ────────────────────────────────────────────────────────────────
UNION ALL
SELECT 'inv_missing_so_ref', COUNT(*) FROM invoices v
  WHERE v.deleted_at IS NULL AND v.so_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM sales_orders s WHERE s.id=v.so_id)
UNION ALL
SELECT 'inv_missing_customer', COUNT(*) FROM invoices v
  WHERE v.deleted_at IS NULL AND v.customer_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id=v.customer_id)
UNION ALL
SELECT 'inv_items_orphaned', COUNT(*) FROM invoice_items ii
  WHERE NOT EXISTS (SELECT 1 FROM invoices v WHERE v.id=ii.invoice_id)
UNION ALL
SELECT 'inv_payments_orphaned', COUNT(*) FROM invoice_payments p
  WHERE NOT EXISTS (SELECT 1 FROM invoices v WHERE v.id=p.invoice_id)
-- ── Webstores ───────────────────────────────────────────────────────────────
UNION ALL
SELECT 'ws_items_orphaned', COUNT(*) FROM webstore_order_items wi
  WHERE NOT EXISTS (SELECT 1 FROM webstore_orders wo WHERE wo.id=wi.order_id)
UNION ALL
SELECT 'ws_paid_zero_items', COUNT(*) FROM webstore_orders wo
  WHERE wo.stripe_pi_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM webstore_order_items wi WHERE wi.order_id=wo.id)
UNION ALL
SELECT 'ws_order_missing_store', COUNT(*) FROM webstore_orders wo
  WHERE wo.store_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM webstores w WHERE w.id=wo.store_id)
-- ── Purchase orders ─────────────────────────────────────────────────────────
UNION ALL
SELECT 'po_lines_orphaned', COUNT(*) FROM purchase_order_lines pl
  WHERE NOT EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id=pl.po_id)
-- ── Exact duplicate SO PO lines ─────────────────────────────────────────────
-- The old create-time race could write the same item/PO/size line twice. The app now serializes
-- that write and self-heals same-PO copies on the next SO save; this invariant keeps residual rows
-- visible instead of letting received units and cost appear doubled indefinitely (SO-2019 PO 57240).
UNION ALL
SELECT 'so_exact_dup_po_line', COUNT(*) FROM (
  SELECT pl.so_item_id, LOWER(TRIM(pl.po_id)),
         pl.sizes - ARRAY['unit_cost','vendor_keys','api_order_id','api_ordered_at','batch_queue_id','batch_po_number','_billed','_tracking_numbers','shipping']::text[]
  FROM so_item_po_lines pl
  WHERE COALESCE(TRIM(pl.po_id),'') <> ''
  GROUP BY pl.so_item_id, LOWER(TRIM(pl.po_id)),
           pl.sizes - ARRAY['unit_cost','vendor_keys','api_order_id','api_ordered_at','batch_queue_id','batch_po_number','_billed','_tracking_numbers','shipping']::text[]
  HAVING COUNT(*) > 1
) g
-- ── Duplicate billing ───────────────────────────────────────────────────────
-- A vendor tracking number is one physical package; the same (tracking, sizes) — or the same
-- (doc, sizes) — appearing twice in a PO line's _bill_details is a double-bill (the 2026-07
-- SportsInc re-import applied invoices a second time under a different doc number). Counts the
-- DISTINCT so_item_po_lines carrying at least one such duplicate group.
UNION ALL
SELECT 'so_dup_bill_shipment', COUNT(DISTINCT id) FROM (
  SELECT pl.id
  FROM so_item_po_lines pl,
       LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(pl.sizes->'_bill_details')='array' THEN pl.sizes->'_bill_details' ELSE '[]'::jsonb END) d
  WHERE COALESCE(NULLIF(d->>'tracking',''), d->>'doc') IS NOT NULL
  GROUP BY pl.id, COALESCE(NULLIF(d->>'tracking',''), d->>'doc'), d->'sizes'
  HAVING COUNT(*)>1
) g
-- ── "PO dropped from portal" — orphaned PO-number claim ───────────────────────
-- Signature of SO-1663 (PO 28950 SANBA, 2026-07-31): a rep reserves a product-PO number
-- (po_number_claims is written the instant the PO form opens — see OrderEditor.js) but the
-- line is overwritten (two-tab / never-flushed) before it reaches so_item_po_lines. The number
-- is claimed; no PO line ever exists. This is a LEAD, not a proven loss — po_number_claims is
-- intentionally noisy (a claim fires on every PO-form open, and reps abandon numbers routinely),
-- so it is de-noised three ways so the count tracks REAL gaps:
--   1. The claimed number appears in NO so_item_po_lines.po_id on the order (whole-number match,
--      so an 'NSA'-numbered batch promotion or a re-tagged line still counts as covered).
--   2. The order still has a line item carrying ZERO PO lines (an actual uncovered item — filters
--      out abandoned forms on fully-covered orders and the char-by-char claim spam of one number).
--   3. The claim is older than a day (a fresh claim on an in-progress order is normal; a dangling
--      one with an uncovered item is not — SO-1663's 28950 dangled 7/28→7/31).
-- Above baseline → triage each the way SO-1663 was (audit_log for the item/PO; confirm a sibling
-- item has a PO line while this one has none). Drill-down: order-integrity-scan.sql §2g.
UNION ALL
SELECT 'so_orphaned_po_claim', COUNT(*) FROM (
  SELECT DISTINCT s.id
  FROM sales_orders s
  JOIN po_number_claims c ON c.so_id = s.id
  WHERE s.deleted_at IS NULL AND s.id NOT LIKE 'SO-0DEMO%'
    AND c.claimed_at < now() - interval '1 day'
    AND NOT EXISTS (
      SELECT 1 FROM so_items i
      JOIN so_item_po_lines p ON p.so_item_id = i.id
      WHERE i.so_id = s.id AND p.po_id ~ ('\y'||c.n||'\y')
    )
    AND EXISTS (
      SELECT 1 FROM so_items i
      WHERE i.so_id = s.id
        AND NOT EXISTS (SELECT 1 FROM so_item_po_lines p WHERE p.so_item_id = i.id)
    )
) g
ORDER BY violations DESC, check_name;
