-- 036 — OMG store delivery mode
-- Records how an OMG pop-up store is fulfilled so the Sales Order flow knows
-- whether per-player shipping labels are needed.
--   ship_home      → ship to each parent's home; ShipStation labels per player.
--   deliver_school → bulk delivery to the school/club; NO per-player labels.
-- Must be selected on the store setup page before the Sales Order can be created.

ALTER TABLE omg_stores ADD COLUMN IF NOT EXISTS delivery_mode text;
COMMENT ON COLUMN omg_stores.delivery_mode IS 'How the OMG store fulfills: ship_home = per-player shipping labels to each parent; deliver_school = bulk delivery to the school/club, no per-player labels.';
