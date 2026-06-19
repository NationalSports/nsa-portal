-- 039: record each shipment's ACTUAL ShipStation cost so order + sales-order
-- shipping costs can be reconciled from real billed amounts (not just quotes).
alter table webstore_shipments add column if not exists cost numeric;
