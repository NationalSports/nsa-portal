// A line's position is presentation, not identity. Existing rows carry line_id;
// legacy offline drafts can be matched only when their garment identity is unique.
export const garmentIdentity = item => JSON.stringify([
  item?.sku || '', item?.color || '', item?.product_id || '',
  item?.sku || item?.product_id ? '' : (item?.name || item?.custom_desc || ''),
]);
export const lineIntentKey = (item, index) => item?.line_id ? 'line:' + item.line_id : 'garment:' + garmentIdentity(item);
export function matchingClientLine(dbItem, clientItems) {
  if (dbItem.line_id) {
    const byId = clientItems.filter(it => it.line_id === dbItem.line_id);
    if (byId.length === 1) return byId[0];
    if (byId.length > 1) return { ...byId[0], decorations: [] }; // invalid duplicate identity fails closed
  }
  const key = garmentIdentity(dbItem);
  const matches = clientItems.filter(it => (!it.line_id || !dbItem.line_id) && garmentIdentity(it) === key);
  if (matches.length === 1) return matches[0];
  // Legacy duplicate garments cannot be distinguished after reordering. The
  // lowest decoration count ensures ambiguity cannot authorize a silent loss.
  if (matches.length > 1) return matches.reduce((a,b) => (a.decorations?.length||0) <= (b.decorations?.length||0) ? a : b);
  return null;
}

export const newOrderLineId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'line-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
