// Shared ShipStation -> webstore line reconciliation.
//
// ShipStation normally echoes our webstore_order_items.id in lineItemKey, but
// older/imported orders and some shipment payloads omit it. In that case we
// fall back to SKU + size and allocate quantities deterministically so the
// customer tracker still reflects what actually shipped.

const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

function shipmentItemSize(item) {
  const direct = item && (item.size || item.variant);
  if (direct) return norm(direct).replace(/^size\s+/, '');
  const opt = (item && Array.isArray(item.options) ? item.options : []).find((o) => /size/i.test(String(o && o.name)));
  if (opt && opt.value) return norm(opt.value).replace(/^size\s+/, '');
  const m = String((item && item.name) || '').match(/(?:^|[·|,\s])size\s+([^·|,\s]+)/i);
  return m ? norm(m[1]) : '';
}

function shipmentItemKey(item) {
  return item && (item.lineItemKey || item.line_item_key || item.webstoreItemId || null);
}

function shipmentQty(item) {
  return Math.max(0, Number(item && (item.qty != null ? item.qty : item.quantity)) || 0);
}

function planShipmentLineUpdates(orderItems, shipments) {
  const lines = (orderItems || []).filter((i) => !i.is_bundle_parent && i.line_status !== 'cancelled');
  const byId = new Map(lines.map((i) => [String(i.id), i]));
  const shipped = new Map(lines.map((i) => [String(i.id), 0]));

  const allocate = (line, amount) => {
    if (!line || amount <= 0) return 0;
    const id = String(line.id);
    const ordered = Math.max(0, Number(line.qty) || 0);
    const used = shipped.get(id) || 0;
    const add = Math.min(amount, Math.max(0, ordered - used));
    if (add > 0) shipped.set(id, used + add);
    return add;
  };

  for (const shipment of shipments || []) {
    for (const item of (shipment && shipment.items) || []) {
      let remaining = shipmentQty(item);
      if (!remaining) continue;

      const exact = shipmentItemKey(item);
      if (exact != null && byId.has(String(exact))) {
        allocate(byId.get(String(exact)), remaining);
        continue;
      }

      const sku = norm(item && item.sku);
      let candidates = sku ? lines.filter((line) => norm(line.sku) === sku) : [];
      const size = shipmentItemSize(item);
      if (size) {
        const sized = candidates.filter((line) => norm(line.size).replace(/^size\s+/, '') === size);
        if (sized.length) candidates = sized;
      }

      // Multiple customer lines can legitimately share SKU + size. Allocate in
      // stable order up to each line's ordered quantity instead of marking every
      // matching line shipped (the previous legacy behavior over-counted).
      for (const line of candidates) {
        const added = allocate(line, remaining);
        remaining -= added;
        if (remaining <= 0) break;
      }
    }
  }

  return lines.map((line) => {
    const shippedQty = shipped.get(String(line.id)) || 0;
    const orderedQty = Math.max(0, Number(line.qty) || 0);
    return {
      id: line.id,
      shipped_qty: shippedQty,
      line_status: orderedQty > 0 && shippedQty >= orderedQty ? 'shipped' : line.line_status,
    };
  }).filter((u) => u.shipped_qty > 0);
}

module.exports = { planShipmentLineUpdates, shipmentItemKey, shipmentItemSize };
