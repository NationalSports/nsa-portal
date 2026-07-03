-- Migration 070: sales_orders._webstore_fundraise
--
-- Club fundraising collected through a webstore is money owed to the team, not NSA
-- margin. When a store's orders are batched into a Sales Order, that fundraising is
-- baked into each garment's unit_sell (so the SO total reconciles to what was collected).
-- Without an offsetting cost, calcGP counted it as gross profit and reps earned
-- commission on the club's passthrough.
--
-- This column carries the batch's net-of-discount fundraising as an SO-level COST,
-- exactly like _inbound_freight: calcGP subtracts it, keeping fundraising out of the GP
-- that rep commission is paid on. Populated by webstoreCreateSO (src/App.js) at batch time.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is the
-- source-of-truth copy.

alter table sales_orders add column if not exists _webstore_fundraise numeric default 0;
