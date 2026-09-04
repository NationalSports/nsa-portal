const norm = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const PO_NON_SIZE_FIELDS = new Set([
  'status', 'po_id', 'received', 'shipments', 'cancelled', 'vendor', 'created_at',
  'expected_date', 'memo', 'po_type', 'unit_cost', 'drop_ship', 'billed',
  'tracking_numbers', 'deco_vendor', 'deco_type', 'notes', 'shipping',
  'batch_queue_id', 'batch_po_number', 'preexisting', 'email_history',
  'api_order_id', 'api_ordered_at', 'vendor_keys',
]);

const poSizeQuantities = po => Object.fromEntries(Object.entries(po || {}).filter(([key, value]) => (
  !key.startsWith('_') && !PO_NON_SIZE_FIELDS.has(key) && typeof value === 'number' && value > 0
)));

// Display line numbers are regenerated after a removal, so they cannot safely
// key resolver, picker, or removal state. This identity survives renumbering.
export function apiLineSourceKey(line) {
  return [
    line?.sourceSO, line?.sourcePO, line?.sourceBatchId,
    Number.isInteger(line?.sourceItemIdx) ? line.sourceItemIdx : '',
    line?.sourceSku || line?.style, line?.sourceColor || line?.color, line?.size,
  ].map(norm).join('|');
}

const poHasHistory = po => {
  const anyPositive = value => value && Object.values(value).some(qty => Number(qty) > 0);
  return !!(po && (po.api_order_id || po.api_ordered_at || po.vendor_keys?.order_no
    || anyPositive(po.received) || anyPositive(po.billed)
    || (po.shipments || []).length || (po.tracking_numbers || []).length));
};

// Remove one not-yet-submitted vendor line (one SKU/color/size) from its source PO.
// The merchandise item remains on the SO; reducing the PO commitment makes that
// quantity available to source again from another vendor.
export function removeApiLineFromPoItems(items, line) {
  const sourcePo = String(line?.sourcePO || '');
  const sourceSku = norm(line?.sourceSku || line?.style);
  const sourceColor = norm(line?.sourceColor || line?.color);
  const size = String(line?.size || '');
  const removeQty = Math.max(0, Number(line?.quantity) || 0);
  if (!sourcePo || !size || removeQty <= 0) return { items, removed: false, reason: 'This API line is missing its PO source.' };

  let itemIndex = Number.isInteger(line?.sourceItemIdx) ? line.sourceItemIdx : -1;
  const matchesItem = item => item && (!sourceSku || norm(item.sku) === sourceSku)
    && (!sourceColor || !item.color || norm(item.color) === sourceColor);
  if (itemIndex < 0 || !matchesItem(items?.[itemIndex])) {
    itemIndex = (items || []).findIndex(item => matchesItem(item)
      && (item.po_lines || []).some(po => po.po_id === sourcePo));
  }
  if (itemIndex < 0) return { items, removed: false, reason: 'The source item could not be found on the sales order.' };

  const poIndex = (items[itemIndex].po_lines || []).findIndex(po => po.po_id === sourcePo);
  if (poIndex < 0) return { items, removed: false, reason: 'The source PO line could not be found.' };
  const po = items[itemIndex].po_lines[poIndex];
  if (poHasHistory(po)) return { items, removed: false, reason: 'This line already has API, receiving, billing, or shipment history and cannot be removed here.' };
  const current = Math.max(0, Number(po[size]) || 0);
  if (current <= 0) return { items, removed: false, reason: `The ${size} quantity is no longer on this PO.` };

  const nextPo = { ...po };
  const nextQty = Math.max(0, current - Math.min(current, removeQty));
  if (nextQty > 0) nextPo[size] = nextQty;
  else delete nextPo[size];
  const unitsLeft = Object.values(poSizeQuantities(nextPo)).reduce((sum, value) => sum + value, 0);
  const nextLines = unitsLeft > 0
    ? items[itemIndex].po_lines.map((entry, index) => index === poIndex ? nextPo : entry)
    : items[itemIndex].po_lines.filter((_, index) => index !== poIndex);
  const nextItems = items.map((item, index) => index === itemIndex ? { ...item, po_lines: nextLines } : item);
  return { items: nextItems, removed: true, itemIndex, poId: sourcePo, size, quantity: current - nextQty };
}

export function removeApiLineFromBatchPOs(batchPOs, line) {
  const batchId = line?.sourceBatchId;
  const sourceSku = norm(line?.sourceSku || line?.style);
  const sourceColor = norm(line?.sourceColor || line?.color);
  const size = String(line?.size || '');
  const removeQty = Math.max(0, Number(line?.quantity) || 0);
  if (!batchId || !size || removeQty <= 0) return batchPOs;

  return (batchPOs || []).map(bp => {
    if (bp.id !== batchId) return bp;
    const nextItems = (bp.items || []).map(item => {
      const idxMatch = Number.isInteger(line?.sourceItemIdx) && item.item_idx === line.sourceItemIdx;
      const skuMatch = (!sourceSku || norm(item.sku) === sourceSku)
        && (!sourceColor || !item.color || norm(item.color) === sourceColor);
      if (!idxMatch && !skuMatch) return item;
      const sizes = { ...(item.sizes || {}) };
      const current = Math.max(0, Number(sizes[size]) || 0);
      const next = Math.max(0, current - Math.min(current, removeQty));
      if (next > 0) sizes[size] = next;
      else delete sizes[size];
      const qty = Object.values(sizes).reduce((sum, value) => sum + (Number(value) || 0), 0);
      return { ...item, sizes, qty };
    }).filter(item => Object.values(item.sizes || {}).some(qty => Number(qty) > 0));
    const total_cost = nextItems.reduce((sum, item) => sum + Object.entries(item.sizes || {}).reduce((lineSum, [sz, qty]) => {
      const unit = Number(item._size_costs?.[sz] ?? item._sizeCosts?.[sz] ?? item.unit_cost) || 0;
      return lineSum + (Number(qty) || 0) * unit;
    }, 0), 0);
    return { ...bp, items: nextItems, total_cost };
  }).filter(bp => (bp.items || []).length > 0);
}

export function apiVerificationForPoLine(item, po) {
  const rows = Array.isArray(po?.vendor_keys?.lines) ? po.vendor_keys.lines : [];
  const sku = norm(item?.sku);
  const exact = rows.filter(row => sku && norm(row.style || row.sku) === sku);
  const relevant = exact.length ? exact : rows.filter(row => {
    const style = norm(row.style || row.sku);
    return !sku || !style || sku.startsWith(style) || style.startsWith(sku);
  });
  const bySize = {};
  relevant.forEach(row => {
    const size = String(row.size || '');
    if (!size) return;
    const prev = bySize[size] || { quantity: 0, warehouses: [] };
    prev.quantity += Number(row.qty) || 0;
    const warehouse = row.warehouse || row.warehouse_name || '';
    if (warehouse && !prev.warehouses.includes(warehouse)) prev.warehouses.push(warehouse);
    bySize[size] = prev;
  });
  const expectedBySize = poSizeQuantities(po);
  const discrepancies = [...new Set([...Object.keys(expectedBySize), ...Object.keys(bySize)])]
    .filter(size => Number(expectedBySize[size] || 0) !== Number(bySize[size]?.quantity || 0))
    .map(size => ({ size, expected: Number(expectedBySize[size] || 0), recorded: Number(bySize[size]?.quantity || 0) }));
  const accepted = !!po?.api_order_id;
  const hasLineDetail = relevant.length > 0;
  const verified = accepted && hasLineDetail && discrepancies.length === 0;
  return {
    accepted, verified, hasLineDetail, orderId: po?.api_order_id || '',
    expectedBySize, bySize, discrepancies, rows: relevant,
  };
}
