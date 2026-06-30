-- 038: shipping module — reprint, void, and partial-quantity line shipping.
-- Additive/nullable columns only; safe to run on a live database.

-- Last purchased label, kept so the shipping team can reprint without re-buying.
alter table webstore_orders add column if not exists label_data text;
-- ShipStation shipment id of the last label, so it can be voided.
alter table webstore_orders add column if not exists shipstation_shipment_id text;

-- Units shipped so far on a line (enables shipping part of a line's quantity and
-- showing the remaining). missing_qty stays a separate "short right now" flag.
alter table webstore_order_items add column if not exists shipped_qty integer not null default 0;
