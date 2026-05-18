-- ═══════════════════════════════════════════════════════════════════
-- NSA Portal — Migration 010: disable_cc_pay flag on customers
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════
-- Lets a parent or sub-account opt out of the "Pay Now" credit-card flow
-- in the coach portal. Customers who only pay by check or ACH won't see
-- the button. Setting cascades from parent to sub-accounts via savC().

DO $$ BEGIN
  ALTER TABLE customers ADD COLUMN disable_cc_pay BOOLEAN DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
