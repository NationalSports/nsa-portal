-- Restore EST-2522 (Glen A Wilson HS Girls Basketball — "2026 Spirit Pack")
--
-- WHY: Jered built this estimate on 2026-09-11 06:26–06:41 PDT, but his tab was locked out by the
-- optimistic-concurrency guard from 06:29:46 onward (see stale_save_log: base_version 3 vs cur_version 4,
-- 18 rejected saves over 9 minutes). Six of the seven garments and 11 of the 12 decorations were therefore
-- NEVER written to the database. The PDF he sent the customer was rendered from his browser's memory.
--
-- The complete document survives in document_history_snapshots seq=955 (captured 13:41:38 UTC), which
-- matches the customer-facing PDF line-for-line (subtotal $3,064.65 / total $3,428.45).
--
-- This script replays that snapshot through save_estimate — the same RPC the app itself uses — so
-- versioning, audit_log rows, line_ids and the decoration-shrink guards all behave exactly as a normal save.
--
-- BEFORE RUNNING: make sure nobody has EST-2522 open in a browser tab. A tab still holding the damaged
-- 1-item copy can re-save over this restore. Pre-restore state is backed up in
-- public.est2522_prerestore_backup_20260911.

BEGIN;

WITH snap AS (
  SELECT entry->'snapshot' AS s
  FROM document_history_snapshots
  WHERE document_id = 'EST-2522' AND seq = 955
),
payload AS (
  SELECT
    (SELECT s - 'items' - 'art_files' - 'jobs' FROM snap) AS p_est,
    (SELECT jsonb_agg((i - '_is_clearance' - 'pricing_group')
                      || jsonb_build_object('item_index', ord - 1) ORDER BY ord)
       FROM snap, jsonb_array_elements(s->'items') WITH ORDINALITY AS t(i, ord)) AS p_items,
    (SELECT jsonb_agg(a - '_artEditedFields')
       FROM snap, jsonb_array_elements(s->'art_files') a) AS p_art,
    (SELECT _version FROM estimates WHERE id = 'EST-2522') AS base_version
)
SELECT save_estimate(p_est, p_items, base_version, false, NULL, p_art, NULL, NULL) AS result
FROM payload;

-- Expect: {"estimate_id":"EST-2522","item_count":7,"version":6,...}
-- If it returns "stale":true, nothing was written — re-read the current _version and re-run.

COMMIT;

-- Verification (run after COMMIT):
--   SELECT i.item_index, i.sku, i.color, i.unit_sell, i.est_qty, i.sizes,
--          (SELECT count(*) FROM estimate_item_decorations d WHERE d.estimate_item_id = i.id) AS decos
--     FROM estimate_items i WHERE i.estimate_id = 'EST-2522' ORDER BY i.item_index;
--   -- Expect 7 rows / 12 decorations total, and 3 rows in estimate_art_files.
