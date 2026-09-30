-- Production packets for every sales order, not only webstore batches.
-- A packet row is scoped to a webstore (store_id) or, for an order that never came
-- from a store, to that one sales order (store_id null, so_id set). Additive and
-- backward compatible: every existing row already has a store_id.
alter table public.production_packet_links alter column store_id drop not null;
alter table public.production_packet_notes alter column store_id drop not null;
alter table public.production_packet_revisions alter column store_id drop not null;
alter table public.production_packet_message_shares alter column store_id drop not null;

alter table public.production_packet_links add constraint production_packet_links_scope check (store_id is not null or so_id is not null);
alter table public.production_packet_notes add constraint production_packet_notes_scope check (store_id is not null or so_id is not null);
alter table public.production_packet_revisions add constraint production_packet_revisions_scope check (store_id is not null or so_id is not null);

create index if not exists production_packet_links_so_scope_idx on public.production_packet_links(so_id) where store_id is null;
create index if not exists production_packet_notes_so_scope_idx on public.production_packet_notes(so_id) where store_id is null;
create index if not exists production_packet_revisions_so_scope_idx on public.production_packet_revisions(so_id, created_at desc) where store_id is null;

-- record_production_packet_shipment already works for order-only packets: with
-- p_store_id null it accepts only an SO whose webstore_id is null, and a recipient
-- link must then name that SO (the scope check above guarantees a store-less link has one).
