// A production packet covers either a webstore (every SO batched from it) or, for an
// order that never came from a store, that one sales order. Packet tables key the
// second case by so_id with store_id null (see 20261001090000_production_packet_so_scope).
// Shared by the packet, email and DPO functions so the scope rule lives once.

// Sales orders inside the packet's scope.
const scopedSalesOrders = (ctx, columns) => {
  const q = ctx.admin.from('sales_orders').select(columns);
  return ctx.storeId ? q.eq('webstore_id', ctx.storeId) : q.eq('id', ctx.soId).is('webstore_id', null);
};

// Packet rows (links, notes, revisions) that belong to this scope.
const scopeRows = (q, ctx) => (ctx.storeId ? q.eq('store_id', ctx.storeId) : q.is('store_id', null).eq('so_id', ctx.soId));

// Message shares carry no so_id — the message itself is already checked against the packet.
const storeEq = (q, ctx) => (ctx.storeId ? q.eq('store_id', ctx.storeId) : q.is('store_id', null));

module.exports = { scopedSalesOrders, scopeRows, storeEq };
