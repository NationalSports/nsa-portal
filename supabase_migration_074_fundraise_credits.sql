-- Fundraiser Dollars: store fundraising (OMG + webstore) is credited to the customer as a
-- CASH credit line rather than promo funds. Promo spends at retail repricing; fundraise
-- spends dollar-for-dollar via the existing Apply Credit flow. This flag separates the
-- fundraiser bucket from ordinary account credits so the Promo tab can total them apart.
ALTER TABLE customer_credits ADD COLUMN IF NOT EXISTS is_fundraise BOOLEAN DEFAULT false;
