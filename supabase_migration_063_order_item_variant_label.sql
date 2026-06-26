-- Record the fit/gender label on each order line.
--
-- A fit variant (Adult / Women's / Youth) is already its own product, so the
-- order line's product_id + sku unambiguously identify which cut was bought. This
-- adds the human-readable label alongside, so order views, receipts, and the
-- batched sales order can show "Women's · M" without re-joining to find it.
--
-- Server-authoritative: webstore-checkout reads it from the priced
-- webstore_products row (like price), never from the client cart. Fully additive.
--
-- Applied to project hpslkvngulqirmbstlfx via the Supabase tooling; this file is
-- the source-of-truth copy for the repo's migration history.

ALTER TABLE webstore_order_items ADD COLUMN IF NOT EXISTS variant_label TEXT;
