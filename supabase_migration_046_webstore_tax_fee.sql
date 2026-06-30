-- Webstore checkout: sales tax (Stripe Tax) + card surcharge accounting.
--
-- webstore_orders.tax already exists (migration 011) but was never written.
-- These add the fields the checkout needs to record what was actually charged
-- and to file the tax with Stripe Tax later:
--   cc_fee              - card processing surcharge added to card orders.
--   tax_calculation_id  - Stripe Tax calculation id (created at checkout).
--   tax_transaction_id  - Stripe Tax transaction id (created once paid, for filing).
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE webstore_orders ADD COLUMN IF NOT EXISTS cc_fee NUMERIC DEFAULT 0;
ALTER TABLE webstore_orders ADD COLUMN IF NOT EXISTS tax_calculation_id TEXT;
ALTER TABLE webstore_orders ADD COLUMN IF NOT EXISTS tax_transaction_id TEXT;
