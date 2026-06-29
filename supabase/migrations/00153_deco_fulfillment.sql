-- Slice 2: item-level art routing (in-house vs outside) as a soft flag on the decoration.
-- `fulfillment` = 'outside' (produced by a decorator) | null (in-house, default).
-- `deco_po_id`  = the deco PO this decoration is bundled onto, when set.
-- Either one makes the decoration outsourced: no in-house production job, cost comes from the PO.
-- Additive + idempotent; null fulfillment leaves existing behavior unchanged.
ALTER TABLE so_item_decorations       ADD COLUMN IF NOT EXISTS fulfillment text;
ALTER TABLE so_item_decorations       ADD COLUMN IF NOT EXISTS deco_po_id  text;
ALTER TABLE estimate_item_decorations ADD COLUMN IF NOT EXISTS fulfillment text;
ALTER TABLE estimate_item_decorations ADD COLUMN IF NOT EXISTS deco_po_id  text;
