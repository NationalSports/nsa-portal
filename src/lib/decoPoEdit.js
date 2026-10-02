import { isGarmentDecoPO, outsourcedDecoTypes, decoIsOutsourced, decoConcreteType } from '../businessLogic';
import { decoPoTotals } from './decoPoUnits';

const arr = v => Array.isArray(v) ? v : [];
const matches = (a, b) => b.id ? a.id === b.id : a.po_id === b.po_id;

export function decoPoEditTotals(previous, draft, items) {
  const unit_cost = Number(draft.unit_cost);
  const purchase = draft.po_mode === 'dtf_purchase';
  const convertedToGarments = !purchase && previous.po_mode === 'dtf_purchase';
  const live = decoPoTotals({ ...previous, unit_cost }, items);
  const qty = purchase ? Number(draft.qty) : convertedToGarments ? live.liveQty : previous.qty;
  const perItem = Object.keys(previous.item_costs || {}).length > 0;
  const expected_cost = Math.round((perItem
    ? purchase && previous.qty > 0 ? qty * live.liveExpected / previous.qty : live.liveExpected
    : qty * unit_cost) * 100) / 100;
  return { qty, unit_cost, expected_cost };
}

// Correct an existing PO and its local links in one order save. Never submits to
// a vendor, changes bills/tracking, or replaces approval/production history.
export function reviseDecoPO(order, previous, edited, { actor = 'Rep', artStatusForFile, activeProd = () => false, now = new Date().toISOString() } = {}) {
  const next = { ...previous, ...edited, id: previous.id };
  if (!String(next.po_id || '').trim()) throw new Error('PO number cannot be empty');
  next.po_id = next.po_id.trim();
  const otherPOs = arr(order.deco_pos).filter(p => !matches(p, previous));
  if (otherPOs.some(p => p.po_id === next.po_id) || arr(order.items).some(it => arr(it.po_lines).some(p => p.po_id === next.po_id))) {
    throw new Error('That PO number already exists on this order');
  }
  if (!Number.isFinite(next.qty) || next.qty < 0 || !Number.isFinite(next.unit_cost) || next.unit_cost < 0) {
    throw new Error('Quantity and unit cost must be valid, non-negative numbers');
  }
  if (previous.topstar_service && next.po_mode !== previous.po_mode) throw new Error('An art-service PO cannot be converted to garment decoration');
  const wasPurchase = previous.po_mode === 'dtf_purchase';
  const purchase = next.po_mode === 'dtf_purchase';
  const modeChanged = wasPurchase !== purchase;
  if (modeChanged && !purchase && !arr(next.item_idxs).length) throw new Error('Use Edit Items to select garments before switching to outside decoration');
  const removed = new Set(arr(previous.item_idxs).filter(ii => !isGarmentDecoPO(next) || !arr(next.item_idxs).includes(ii)));
  const remainingOrder = { ...order, deco_pos: otherPOs };
  const remainingTypes = outsourcedDecoTypes(remainingOrder);
  const oldTypes = outsourcedDecoTypes({ ...order, deco_pos: [previous] });
  const items = arr(order.items).map((it, ii) => ({ ...it, decorations: arr(it.decorations).map(d => {
    const ownLink = d.deco_po_id === previous.po_id || (previous.id && d.deco_po_id === previous.id);
    const type = decoConcreteType(order, d);
    const stillOut = decoIsOutsourced(remainingTypes[ii], type);
    const oldVendorFlag = isGarmentDecoPO(previous) && (!d.deco_po_id || ownLink) && d.fulfillment === 'outside' && (!d.vendor || d.vendor === previous.vendor)
      && decoIsOutsourced(oldTypes[ii], type);
    if (removed.has(ii) && (ownLink || oldVendorFlag) && !stillOut) {
      const nd = { ...d, fulfillment: undefined, deco_po_id: undefined, vendor: undefined, outside_art: false };
      if (d._outside_sell) { delete nd.sell_override; delete nd.sell_each; delete nd._outside_sell; }
      return nd;
    }
    if (ownLink) return { ...d, deco_po_id: purchase ? undefined : next.po_id, ...(d.vendor === previous.vendor ? { vendor: next.vendor } : {}) };
    if (oldVendorFlag && isGarmentDecoPO(next) && arr(next.item_idxs).includes(ii)) return { ...d, vendor: next.vendor };
    return d;
  }) }));
  const pos = arr(order.deco_pos).map(p => matches(p, previous) ? next : p);
  const touchedArt = new Set([...arr(previous.art_file_ids), ...arr(next.art_file_ids)]);
  const art_files = arr(order.art_files).map(a => {
    if (!touchedArt.has(a.id)) return a;
    const source = purchase && arr(next.art_file_ids).includes(a.id) ? next
      : otherPOs.find(p => p.po_mode === 'dtf_purchase' && arr(p.art_file_ids).includes(a.id));
    const owned = a.dtf_purchased?.po_id === previous.po_id;
    let files = arr(a.prod_files).filter(f => !(f?.dtf_order && f.po_id === previous.po_id));
    if (source) {
      if (!files.some(f => f?.dtf_order && f.po_id === source.po_id)) files = [...files, { name: 'DTF films ordered — ' + source.po_id, dtf_order: true, po_id: source.po_id, at: now, by: actor }];
      return { ...a, dtf_purchased: { po_id: source.po_id, vendor: source.vendor, date: now.slice(0, 10) }, prod_files: files, prod_files_attached: true };
    }
    if (!owned && files.length === arr(a.prod_files).length) return a;
    return { ...a, ...(owned ? { dtf_purchased: undefined } : {}), prod_files: files, ...(files.length ? {} : { prod_files_attached: undefined }) };
  });
  const jobs = artStatusForFile ? arr(order.jobs).map(j => {
    if (activeProd(j.prod_status)) return j;
    const ids = arr(j._art_ids).length ? j._art_ids : [j.art_file_id];
    const liveIds = ids.filter(id => id && id !== '__tbd');
    if (!liveIds.length || !liveIds.some(id => touchedArt.has(id))) return j;
    const statuses = liveIds.map(id => artStatusForFile(art_files.find(a => a.id === id), j.deco_type));
    return { ...j, art_status: statuses.find(s => s !== 'art_complete') || 'art_complete' };
  }) : order.jobs;
  return { ...order, items, deco_pos: pos, art_files, jobs, updated_at: now };
}
