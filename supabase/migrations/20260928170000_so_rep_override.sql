-- Per-sales-order rep override.
--
-- The SO editor's Rep pencil used to call changeDocRep(), which rewrote customers.primary_rep_id —
-- so reassigning ONE order (e.g. to take its art approvals off the account rep's dashboard) silently
-- moved the whole account, every other SO/estimate/invoice and its commission, to the new rep.
-- Now the pencil writes sales_orders.rep_id instead; the account rep only changes from the customer
-- record. NULL = follow the account (customers.primary_rep_id, then sales_orders.created_by), so
-- every existing order attributes exactly as before. Precedence lives in commissionRepId()
-- (src/businessLogic.js): invoices.rep_id > sales_orders.rep_id > account rep > SO creator.
-- Text to match customers.primary_rep_id / invoices.rep_id.
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS rep_id text;

COMMENT ON COLUMN public.sales_orders.rep_id IS
  'Per-SO rep override for display, art/production boards and commission attribution. NULL = inherit the account rep (customers.primary_rep_id, then created_by). Read through commissionRepId() in src/businessLogic.js.';
