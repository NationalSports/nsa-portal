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

// Outgoing save payload: every line leaves the client carrying a line_id. A line the rep just
// added has none, and save_estimate's legacy matcher then hands it the id of the EXISTING line
// with the same SKU/color/product — so the upsert hits that row twice and the whole save is
// rejected (ESTIMATE_DUPLICATE_LINE_ID; EST-2434, a second "R095ZM / Default" line, 47 rejections
// in a day). A blank line adopts an existing line's id only when exactly one DB line with the
// same garment identity is not already claimed by another client line — the offline-draft case
// the matcher exists for. A claimed sole match means this is a NEW line: it gets a fresh id.
// New garments receive an ID before the request; ambiguous legacy matches still fail closed.
export function resolveOutgoingLineIds(clientItems, dbItems) {
  const claimed = new Set((clientItems || []).map(it => it?.line_id).filter(Boolean));
  return (clientItems || []).map(it => {
    if (!it || it.line_id) return it;
    const key = garmentIdentity(it);
    const matches = (dbItems || []).filter(db => db?.line_id && garmentIdentity(db) === key);
    const open = matches.filter(db => !claimed.has(db.line_id));
    if (!matches.length || !open.length) { const line_id = newOrderLineId(); claimed.add(line_id); return { ...it, line_id }; }
    if (open.length === 1) { claimed.add(open[0].line_id); return { ...it, line_id: open[0].line_id }; }
    return it;
  });
}

// Stamp the editor's actual draft before price-locking clones it for persistence.
// Otherwise the server acknowledgement only updates the clone, and the next edit
// of two identical garments arrives without the IDs from their first save.
export function stampEstimateDraftLineIds(draft, base) {
  if (!base || base._itemsHydrated === false || base._recoveryHydrated === false) return;
  const previous = base.items || [];
  if (previous.some(item => !item.line_id)) return;
  resolveOutgoingLineIds(draft.items || [], previous).forEach((item, index) => {
    if (item?.line_id && !draft.items[index].line_id) draft.items[index].line_id = item.line_id;
  });
}
