-- Customer ↔ staff messaging on webstore / OMG orders.
--
-- We reuse the existing `messages` table (same one used for Sales Order,
-- Estimate, Job and Issue threads) with entity_type='webstore_order' and
-- entity_id = webstore_orders.id. That means customer order threads show up in
-- the existing Messages center automatically — routed to the store's CSR/rep
-- via the existing tagged_members mechanism.
--
-- Two small columns are added so we can:
--   • from_customer  → render the customer's side of the thread (and label it
--                      "Customer" in the inbox) vs. staff replies.
--   • read_by_staff  → drive the per-order "new customer reply" badge in the
--                      OMG portal (independent of the inbox's per-user reads).
--
-- entity_type / entity_id already exist (migration 00018); tagged_members from
-- migration 00010. This migration only adds the two flags + a lookup index.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS from_customer BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_by_staff BOOLEAN DEFAULT false;

-- Fast lookup of one order's thread (portal + OMG portal both filter by these).
CREATE INDEX IF NOT EXISTS idx_messages_entity
  ON public.messages(entity_type, entity_id);
