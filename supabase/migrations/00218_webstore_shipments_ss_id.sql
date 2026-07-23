-- Audit fix (build audit, MEDIUM): dedupe ShipStation shipments on the ShipStation
-- shipment id.
--
-- THE BUG: shipstation-webhook only deduped on tracking_number. A SHIP_NOTIFY for a
-- shipment WITHOUT a tracking number (some carriers/services) had no idempotency key,
-- so a ShipStation redelivery (retry after a slow first response) inserted a SECOND
-- webstore_shipments row — double-counting cost into label_cost / the SO's shipping
-- cost, and re-driving lines to 'shipped'.
--
-- THE FIX: record ShipStation's own shipment id (present on every shipment, tracking
-- or not) and dedupe on it. NULLs are allowed and treated as distinct by Postgres, so
-- legacy rows (no id) coexist; the webhook pre-checks this id, and the unique index is
-- the concurrency belt — a racing redelivery's second insert errors and is ignored
-- rather than duplicating.
--
-- Rollback:
--   drop index if exists public.webstore_shipments_ss_shipment_id_key;
--   alter table public.webstore_shipments drop column if exists ss_shipment_id;

alter table public.webstore_shipments add column if not exists ss_shipment_id text;

create unique index if not exists webstore_shipments_ss_shipment_id_key
  on public.webstore_shipments(ss_shipment_id);
