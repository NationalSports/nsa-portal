-- Per-invoice rep override.
--
-- Until now the rep on an invoice was purely derived — commissionRepId() in src/businessLogic.js
-- read customers.primary_rep_id, falling back to sales_orders.created_by. That left no way to move
-- a SINGLE invoice to another rep: the invoice detail page's "Rep" pencil called changeDocRep(),
-- which rewrote the customer's primary rep and so silently reassigned every invoice, SO, estimate
-- and (because commission attribution stays live, not frozen at snapshot time) every already-paid
-- commission line on that account.
--
-- NULL means "follow the account" and stays the default for every existing and future invoice, so
-- attribution is unchanged everywhere until someone explicitly sets an override on one invoice.
-- Type is text to match customers.primary_rep_id / commission_snapshots.rep_id, which store the
-- user_profiles UUID as text.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS rep_id text;

COMMENT ON COLUMN public.invoices.rep_id IS
  'Per-invoice rep override for commission and reporting attribution. NULL = inherit the account rep (customers.primary_rep_id, then sales_orders.created_by). Read only through commissionRepId() in src/businessLogic.js.';
