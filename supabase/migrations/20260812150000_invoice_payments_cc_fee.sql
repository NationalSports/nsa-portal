-- ============================================================
-- invoice_payments: add the cc_fee column the client has always
-- written, and the unique key its upsert has always targeted.
--
-- WHY (2026-08-12, INV-1053). A rep reported an invoice paid on
-- 8/11 showing up on his JULY commission statement.
--
-- CommissionsPage puts a commission line in the month of the
-- invoice's LAST PAYMENT, and falls back to the invoice date
-- when an invoice carries no payment rows. INV-1053 (invoiced
-- 7/6, marked paid 8/11) carried none -- so it booked to July.
--
-- It carried none because writing one has never worked from the
-- client. _dbSaveInvoiceInner builds each payment row with a
-- `cc_fee` key, and this table has no cc_fee column; it also
-- upserts `onConflict: 'invoice_id,ref'`, and no unique index
-- covers those columns. So the upsert failed twice over, and the
-- old fallback path then DELETEd every payment row on the
-- invoice before re-inserting the very payload that had just
-- failed -- losing the write and any rows already there, with
-- both errors swallowed.
--
-- The audit log shows the damage precisely: of 30 lifetime
-- invoice_payments INSERTs, every single one was written by the
-- service role (the Stripe reconcile path in
-- netlify/functions/_shared.js, which does not send cc_fee).
-- Not one payment recorded by a human through the portal's
-- Receive Payment button has ever persisted -- 158 of 181 paid
-- invoices have no payment row at all -- and 8 DELETEs by real
-- users mark rows the fallback wiped.
--
-- This migration fixes the schema half. The client half (fail
-- closed instead of deleting on a failed write) ships with it in
-- src/lib/dbEngine.js.
-- ============================================================

-- 1. The column the client sends. Card surcharges are folded into
--    the payment amount; cc_fee tracks how much of it was fee, the
--    same meaning invoices.cc_fee has at the invoice level.
alter table public.invoice_payments
  add column if not exists cc_fee numeric not null default 0;

-- 2. The unique key the upsert targets. Verified free of
--    duplicates and of null refs before creating; the client
--    always coalesces a blank ref to 'pay_<n>' and the server
--    paths always set one, so no row can slip past on a null.
create unique index if not exists invoice_payments_invoice_ref_uniq
  on public.invoice_payments (invoice_id, ref);
