const qty = value => Math.max(0, Number(value) || 0);
const hasUnits = sizes => Object.values(sizes).some(value => qty(value) > 0);
const sameGarment = (a, b) => String(a.sku || '') === String(b.sku || '') && String(a.color || '') === String(b.color || '');
function matchesLine(order, item, index, row) {
  if (row.line_id && item.line_id) return row.line_id === item.line_id;
  const indexed = row.item_idx != null ? order.items?.[Number(row.item_idx)] : null;
  if (indexed && sameGarment(row, indexed)) return Number(row.item_idx) === index;
  return sameGarment(row, item);
}

// The queue can survive a failed SO save. It is a reservation in its own right,
// even when the editor never received the corresponding queued po_line.
export function itemBatchReservations(order, item, index, batches = []) {
  const reservations = new Map();
  for (const batch of batches || []) {
    if (!batch || batch.so_id !== order.id) continue;
    const sizes = {};
    for (const row of batch.items || []) {
      if (!matchesLine(order, item, index, row)) continue;
      // Legacy rows have only an index + garment identity. If lines moved, reserve
      // matching garments conservatively rather than freeing an ambiguous row.
      const rowSizes = Object.keys(row.sizes || {}).length ? row.sizes : { QTY: row.qty };
      for (const [size, value] of Object.entries(rowSizes)) sizes[size] = (sizes[size] || 0) + qty(value);
    }
    if (hasUnits(sizes)) reservations.set(batch.id, { id: batch.id, poId: batch.po_id || batch.id, vendorName: batch.vendor_name || '', sizes });
  }
  // A queued PO whose queue row hasn't loaded must also stay locked. Submitted
  // batches keep batch_queue_id but become waiting/ordered, so exclude those.
  for (const line of item.po_lines || []) {
    if (!line || line.status !== 'queued' || reservations.has(line.batch_queue_id)) continue;
    const sizes = {};
    for (const size of new Set([...Object.keys(item.sizes || {}), 'QTY'])) {
      const value = Math.max(0, qty(line[size]) - qty(line.cancelled?.[size]));
      if (value) sizes[size] = value;
    }
    if (hasUnits(sizes)) {
      const id = line.batch_queue_id || line.po_id;
      const previous = reservations.get(id);
      if (previous) for (const [size, value] of Object.entries(sizes)) previous.sizes[size] = (previous.sizes[size] || 0) + value;
      else reservations.set(id, { id, poId: line.po_id || id, vendorName: line.vendor || '', sizes });
    }
  }
  return [...reservations.values()];
}

export async function checkBatchPoReservations(client, order, entries, localQueue = []) {
  if (!entries?.length) return null;
  let queue = localQueue;
  if (client && order?.id) {
    try {
      const { data, error } = await client.from('app_state').select('value').eq('id', 'batch_pos').maybeSingle();
      if (error) throw error;
      const saved = typeof data?.value === 'string' ? JSON.parse(data.value) : data?.value;
      if (saved != null && !Array.isArray(saved)) throw new Error('Invalid batch queue');
      queue = [...localQueue, ...(saved || [])];
    } catch (_) {
      return { batchError: true, message: 'Could not verify the batch queue. No PO was created. Reload and try again before ordering.' };
    }
  }
  const conflicts = entries.flatMap(({ idx, sizes }) => {
    const item = order.items?.[idx];
    if (!item || !hasUnits(sizes || {})) return [];
    const batches = itemBatchReservations(order, item, idx, queue);
    return batches.length ? [{ sku: item.sku || 'line ' + (idx + 1), batches }] : [];
  });
  return conflicts.length ? { batchReservations: conflicts } : null;
}

export function batchPoReservationMessage(conflict) {
  if (conflict.batchError) return conflict.message;
  return 'Already in a batch: ' + conflict.batchReservations.map(row => row.sku + ' (' + row.batches.map(batch => batch.poId).join(', ') + ')').join('; ')
    + '. Remove these items from Batch POs before creating an independent PO or adding them to another batch.';
}

export function removeQueuedBatchLines(items, batchId) {
  return (items || []).map(item => ({ ...item, po_lines: (item.po_lines || []).filter(line => !(line.batch_queue_id === batchId && line.status === 'queued')) }));
}
