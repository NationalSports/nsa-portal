-- =====================================================================
-- Backfill: embroidery jobs stuck at "upload_emb_files" that already
-- have a DST on file -> art_complete.
--
-- WHY: Until the approval writes were fixed (CoachPortal.js / CustDetail.js,
-- PR #1564), approving a mockup stamped the deco-specific production-files
-- stage unconditionally. An embroidery folder that ALREADY had a .dst
-- attached before approval therefore landed on 'upload_emb_files' and kept
-- prompting the rep to "Upload DST / Mark Art Complete" — even though the
-- DST was already on the art file. The forward fix only affects NEW
-- approvals; this sweep corrects the jobs already parked in that state.
--
-- MATCHES the app rule artProdFilesConfirmed() in src/constants.js for the
-- embroidery path:
--   * prod_files_attached = true                              -> confirmed
--   * prod_files_attached = false                             -> NOT confirmed
--     (explicit invalidation from a recall/update; never overridden here)
--   * otherwise, a .dst attached anywhere on files/prod_files -> confirmed
-- The art file must be 'approved' and the job must currently sit in
-- 'upload_emb_files' (the embroidery production-files stage).
--
-- SCOPE: only so_jobs whose LINKED art_file (so_jobs.art_file_id) is a
-- confirmed embroidery folder. Screen-print ('production_files_needed')
-- and DTF ('order_dtf_transfers') stages are intentionally untouched —
-- a .dst is not their production file, and only an explicit
-- prod_files_attached would confirm them (a separate concern).
--
-- Sets art_status only; it leaves the art file untouched, because the
-- attached .dst already makes artProdFilesConfirmed() true, so buildJobs
-- re-derives art_complete consistently.
--
-- Idempotent: the WHERE guard only touches rows still at 'upload_emb_files'.
-- Re-running is a no-op.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DRY RUN — run this SELECT first to eyeball what will change.
-- Expect one row per job that will flip to art_complete.
-- ---------------------------------------------------------------------
select j.so_id,
       so.display_id,
       j.id            as job_id,
       j.art_name,
       a.name          as art_file,
       a.prod_files_attached,
       (a.prod_files_attached is true)                                    as confirmed_by_checkbox,
       exists (
         select 1
         from jsonb_array_elements(coalesce(a.files,'[]'::jsonb) || coalesce(a.prod_files,'[]'::jsonb)) e
         where lower(case when jsonb_typeof(e.value) = 'string' then e.value #>> '{}'
                          else coalesce(e.value->>'name', e.value->>'url') end) like '%.dst'
       )                                                                  as has_dst
from so_jobs j
join so_art_files a on a.so_id = j.so_id and a.id = j.art_file_id
join sales_orders so on so.id = j.so_id
where j.art_status = 'upload_emb_files'
  and a.deco_type = 'embroidery'
  and a.status = 'approved'
  and (
        a.prod_files_attached is true
     or (
          a.prod_files_attached is distinct from false
          and exists (
            select 1
            from jsonb_array_elements(coalesce(a.files,'[]'::jsonb) || coalesce(a.prod_files,'[]'::jsonb)) e
            where lower(case when jsonb_typeof(e.value) = 'string' then e.value #>> '{}'
                             else coalesce(e.value->>'name', e.value->>'url') end) like '%.dst'
          )
        )
      )
order by so.display_id, j.id;

-- ---------------------------------------------------------------------
-- APPLY — once the dry run looks right, run the transaction below.
-- ---------------------------------------------------------------------
BEGIN;

UPDATE so_jobs j
SET art_status = 'art_complete'
FROM so_art_files a
WHERE a.so_id = j.so_id
  AND a.id = j.art_file_id
  AND j.art_status = 'upload_emb_files'
  AND a.deco_type = 'embroidery'
  AND a.status = 'approved'
  AND (
        a.prod_files_attached is true
     OR (
          a.prod_files_attached is distinct from false
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(coalesce(a.files,'[]'::jsonb) || coalesce(a.prod_files,'[]'::jsonb)) e
            WHERE lower(case when jsonb_typeof(e.value) = 'string' then e.value #>> '{}'
                             else coalesce(e.value->>'name', e.value->>'url') end) LIKE '%.dst'
          )
        )
      );

COMMIT;

-- OPTIONAL sync nudge: the app re-derives art_complete from the attached
-- .dst on the next load, so no touch is strictly required. If you want the
-- change to propagate to open tabs immediately via selective sync, bump the
-- parent SOs (use the so_id values the dry run printed):
--   UPDATE sales_orders SET updated_at = now() WHERE id IN ('<so_id>', ...);
