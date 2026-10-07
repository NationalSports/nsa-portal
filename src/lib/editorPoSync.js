// Refreshes can contain a different PO without increasing the line count. Keep
// local edits and add only POs the editor does not know about; never treat a
// changed receipt/quantity on the same PO as another purchase.
const lines = item => Array.isArray(item?.po_lines) ? item.po_lines : [];
const garmentKey = item => JSON.stringify([
  item?.sku || '', String(item?.color || '').trim().toLowerCase(), item?.product_id || '',
  item?.sku || item?.product_id ? '' : (item?.name || item?.custom_desc || ''),
]);
const poKey = po => po?.po_id ? 'po:' + po.po_id : 'legacy:' + JSON.stringify(po);

function incomingItem(local, localItems, incomingItems) {
  const key = garmentKey(local);
  if (local.line_id) {
    const matches = incomingItems.filter(item => item.line_id === local.line_id);
    if (matches.length) return matches.length === 1 && garmentKey(matches[0]) === key ? matches[0] : null;
  }
  // Legacy drafts have no stable IDs. Reordering is safe only for a unique
  // garment on both sides; two identical garments must not exchange POs.
  if (localItems.filter(item => garmentKey(item) === key).length !== 1) return null;
  const matches = incomingItems.filter(item => garmentKey(item) === key && (!local.line_id || !item.line_id));
  return matches.length === 1 ? matches[0] : null;
}

export function mergeExternalPoItems(localItems = [], incomingItems = [], deletedPoIds = [], hydratedPoIds = []) {
  // A previously loaded PO absent from this local line can be an intentional
  // partial removal. As in the save guard, only restore previously unseen POs.
  const deleted = new Set([...deletedPoIds, ...hydratedPoIds]);
  let changed = false;
  const items = localItems.map(item => {
    const incoming = incomingItem(item, localItems, incomingItems);
    if (!incoming) return item;
    const have = new Set(lines(item).map(poKey));
    const added = lines(incoming).filter(po => {
      if (deleted.has(po?.po_id) || have.has(poKey(po))) return false;
      have.add(poKey(po));
      return true;
    });
    if (!added.length) return item;
    changed = true;
    return { ...item, po_lines: [...lines(item), ...added] };
  });
  return changed ? items : localItems;
}
