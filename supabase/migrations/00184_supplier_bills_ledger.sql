-- supplier-bills ledger — extend applied_bills into the server-side system of record
-- for pushed supplier bills (FABLE_HANDOFF_SPECS_2026-07-07 Spec 1).
--
-- Extend-vs-new decision: the spec sketched a new `supplier_bills` table, but 00178
-- already created `applied_bills` as the hard server ledger — unique on
-- (doc_norm, is_credit), written by App.js _recordAppliedBills on every successful
-- apply (Portal push and QB push), and loaded into the cross-machine dedup set.
-- Creating supplier_bills alongside it would mean a THIRD hand-synced copy of bill
-- state (localStorage / applied_bills / supplier_bills). Instead we widen
-- applied_bills to carry the spec's missing columns so one table serves both dedup
-- and Bill History. Column mapping vs the spec's sketch: supplier→vendor,
-- pushed_by→applied_by, pushed_at→applied_at (existing names kept — live rows and
-- the deployed client already use them).
--
-- supplier_bill_holds (00177) stays as-is for parked/resolved worklist rows — its
-- id-keyed upsert/delete lifecycle is not trivially expressible on this
-- doc#-unique audit ledger (rows here are never deleted). Eventual merge noted in
-- the spec; not attempted here.
--
-- New columns (all nullable or defaulted — old clients keep inserting the narrow
-- row shape unchanged, and the new client falls back to that shape until this
-- migration is applied):
--   doc_number     original-casing doc # for display (doc_norm stays the dedup key)
--   status         lifecycle: 'pushed' | 'parked' | 'resolved' | 'failed'
--                  (only 'pushed' is written today; parked/resolved still live in
--                  supplier_bill_holds — reserved for the eventual merge)
--   portal_status  client portal outcome at record time (e.g. 'success')
--   resolution     jsonb resolution note (reserved for the holds merge)
--   applied_so_ids SO ids this bill's costs were applied to
--   raw_meta       parsed bill (rawText stripped) so Bill History can render the
--                  row on a machine that never saw the PDF
--   updated_at     row touch time

alter table public.applied_bills
  add column if not exists doc_number     text,
  add column if not exists status         text not null default 'pushed',
  add column if not exists portal_status  text,
  add column if not exists resolution     jsonb,
  add column if not exists applied_so_ids text[],
  add column if not exists raw_meta       jsonb,
  add column if not exists updated_at     timestamptz not null default now();

-- Guard the lifecycle vocabulary (existing rows are backfilled to 'pushed' by the
-- column default above — correct: every pre-00184 row was written on a successful apply).
alter table public.applied_bills
  drop constraint if exists applied_bills_status_chk;
alter table public.applied_bills
  add constraint applied_bills_status_chk
  check (status in ('pushed','parked','resolved','failed'));

-- RLS: already enabled + staff-only via applied_bills_staff_all (00178, same
-- team_members gate as si_documents / supplier_bill_holds). No policy change needed.
-- Unique (doc_norm, is_credit) + si_doc_number index also already exist (00178).
