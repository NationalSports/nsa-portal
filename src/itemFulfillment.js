// ── Item Fulfillment (IF) record helpers ─────────────────────────────────────
// An IF is a pick_id shared by one or more pick_lines across the items of ONE sales
// order. Until now it had no address of its own: the global search opened the parent
// SO and the warehouse's detail view was reachable only by clicking a row in the open
// pull list. These helpers give an IF a single resolver every entry point shares
// (search, ?if= deep link, barcode scan, warehouse row, order editor), so all of them
// land on the same record — including IFs that are already closed, which the open-pull
// list does not carry.
//
// Kept pure and free of React so the closure logic below ("Not Here") can be tested
// directly; App.js owns the state writes.
import { SZ_ORD } from './constants';
import { safeItems, safePicks, safeArr } from './safeHelpers';

const rank = sz => { const i = SZ_ORD.indexOf(sz); return i === -1 ? 999 : i; };

// Keys on a pick line that are NOT size quantities. Sizes are stored as bare
// numeric fields on the object, so anything numeric that isn't listed here is a size.
export const PICK_META_KEYS = ['pick_id', 'status', 'created_at', 'pulled_at', 'memo', 'ship_dest', 'ship_addr',
  'deco_vendor', 'deco_po_id', 'deco_vendor_id', 'attention', 'notes', '_sku', '_partial',
  'not_here', 'not_here_at', 'not_here_by'];

export const pickSizeKeys = pick => Object.keys(pick || {})
  .filter(k => !PICK_META_KEYS.includes(k) && typeof pick[k] === 'number')
  .sort((a, b) => rank(a) - rank(b));

export const pickUnits = pick => pickSizeKeys(pick).reduce((a, sz) => a + (pick[sz] || 0), 0);

export const normalizeIFId = id => String(id || '').trim().toUpperCase();

// Every (item, pick_line) pair on `so` that belongs to `ifId`, open or closed.
export const ifEntries = (so, ifId) => {
  const want = normalizeIFId(ifId);
  if (!want) return [];
  const out = [];
  safeItems(so).forEach((item, itemIdx) => {
    safePicks(item).forEach((pick, pickIdx) => {
      if (normalizeIFId(pick.pick_id) === want) out.push({ item, itemIdx, pick, pickIdx });
    });
  });
  return out;
};

// Find which sales order owns an IF. Returns null when no order carries it.
export const findIF = (sos, ifId) => {
  const want = normalizeIFId(ifId);
  if (!want) return null;
  for (const so of safeArr(sos)) {
    const entries = ifEntries(so, want);
    if (entries.length) return { so, ifId: normalizeIFId(entries[0].pick.pick_id), entries };
  }
  return null;
};

// Build the task object the warehouse IF detail view renders. Deliberately the SAME
// shape the open-pull list produces, so one view serves both — with two differences
// that matter for a standalone page: `_pickId` is always set (the scan path used to
// omit it, which made the detail view fall back to its legacy single-item shape), and
// a fully pulled IF still resolves instead of coming back empty.
export const buildIFTask = (sos, ifId, { customers = [], reps = [] } = {}) => {
  const found = findIF(sos, ifId);
  if (!found) return null;
  const { so, entries } = found;
  const customer = safeArr(customers).find(c => c.id === so.customer_id) || null;
  const rep = safeArr(reps).find(r => r.id === (customer?.primary_rep_id || so.created_by));
  const daysOut = so.expected_date
    ? Math.ceil((new Date(so.expected_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null;
  const open = entries.filter(e => (e.pick.status || 'pick') !== 'pulled');
  // The IF's own ask drives the detail view, not the order line's full quantity: an item
  // can be split across several IFs and a PO.
  const lead = (open[0] || entries[0]);
  const sizes = {}; const pulled = {};
  entries.forEach(({ pick }) => {
    const closed = (pick.status || 'pick') === 'pulled';
    pickSizeKeys(pick).forEach(sz => {
      const v = pick[sz] || 0;
      if (closed) pulled[sz] = (pulled[sz] || 0) + v;
      else sizes[sz] = (sizes[sz] || 0) + v;
    });
    // A closed line's original ask is only recoverable from not_here (its size fields
    // were overwritten with what was actually found).
    Object.entries(pick.not_here || {}).forEach(([sz, v]) => { sizes[sz] = (sizes[sz] || 0) + (v || 0) });
  });
  const szKeys = [...new Set([...Object.keys(sizes), ...Object.keys(pulled)])].sort((a, b) => rank(a) - rank(b));
  const totalOrdered = szKeys.reduce((a, sz) => a + (sizes[sz] || 0) + (pulled[sz] || 0), 0);
  const totalPulled = szKeys.reduce((a, sz) => a + (pulled[sz] || 0), 0);
  return {
    so, soId: so.id, _pickId: found.ifId, pickId: found.ifId,
    item: lead.item, itemIdx: lead.itemIdx, _activePicks: open.map(e => e.pick),
    cName: customer?.name || 'Unknown', alpha: customer?.alpha_tag || '',
    rep: rep?.name?.split(' ')[0] || '—',
    daysOut, urgent: daysOut != null && daysOut <= 3,
    sku: lead.item.sku, name: lead.item.name, brand: lead.item.brand || '', color: lead.item.color || '',
    sizes, pulled, szKeys,
    totalOrdered, totalPulled, needsPull: Math.max(0, totalOrdered - totalPulled),
    isClosed: open.length === 0,
    shipDest: (entries.find(e => e.pick.ship_dest)?.pick.ship_dest) || 'in_house',
    _skus: [...new Set(entries.map(e => e.item.sku).filter(Boolean))],
  };
};

// ── "Not Here" ───────────────────────────────────────────────────────────────
// The warehouse went to the shelf and the goods are not there. Three things follow,
// and they have to happen together or the shortfall goes unnoticed:
//   1. House stock for those sizes is wrong — it reads more than zero for something
//      that isn't on the shelf. Set it to 0 so nothing else gets promised against it
//      (the QuickBooks inventory valuation reads these same quantities, so the
//      balance-sheet number follows on the next post; the portal is the source of truth).
//   2. The IF must stop waiting on units that will never be pulled: the declared sizes
//      close at 0 and, once nothing on the line is still expected, the line closes as a
//      short pull — which is what tells the rep.
//   3. What was originally asked for is recorded in `not_here`, because closing a pick
//      line overwrites its size fields with what was actually found. Without it the
//      short is invisible on the IF afterwards, and the order editor cannot show the rep
//      WHY the line came back empty.
// The ordered quantity on the SO line is untouched — the customer still wants the goods;
// the gap is what the rep raises a PO for (the existing "Short on pull" action item
// derives from ordered − pulled − on-PO and fires as soon as the line closes).
//
// Returns the new items array plus the per-product inventory writes, or null when the
// call is a no-op. Pure: the caller performs the writes.
export const buildNotHere = ({ so, ifId, itemIdx, sizes, by, at } = {}) => {
  const want = normalizeIFId(ifId);
  const items = safeItems(so);
  const stamp = at || new Date().toLocaleString();
  // sizes omitted / empty = "nothing on this IF is here": every open size on every line.
  const targets = new Map();// itemIdx -> Set(size)
  const scope = itemIdx == null ? null : Number(itemIdx);
  ifEntries(so, want).forEach(({ itemIdx: ii, pick }) => {
    if (scope != null && ii !== scope) return;
    if ((pick.status || 'pick') === 'pulled') return;// already closed — nothing left to declare
    const want2 = Array.isArray(sizes) && sizes.length
      ? sizes.filter(sz => (pick[sz] || 0) > 0)
      : pickSizeKeys(pick).filter(sz => (pick[sz] || 0) > 0);
    if (want2.length) targets.set(ii, new Set(want2));
  });
  if (targets.size === 0) return null;

  let units = 0;
  const declared = [];// [{itemIdx, sku, productId, size, qty}]
  const newItems = items.map((it, ii) => {
    const szSet = targets.get(ii);
    if (!szSet) return it;
    const pickLines = safePicks(it).map(pick => {
      if (normalizeIFId(pick.pick_id) !== want || (pick.status || 'pick') === 'pulled') return pick;
      const notHere = { ...(pick.not_here || {}) };
      const next = { ...pick };
      szSet.forEach(sz => {
        const qty = pick[sz] || 0;
        if (qty <= 0) return;
        notHere[sz] = (notHere[sz] || 0) + qty;
        next[sz] = 0;
        units += qty;
        declared.push({ itemIdx: ii, sku: it.sku, productId: it.product_id || null, size: sz, qty });
      });
      next.not_here = notHere;
      next.not_here_at = stamp;
      if (by) next.not_here_by = by;
      // Close the line only once nothing on it is still expected. A partial "not here"
      // (one size missing, the rest on the shelf) leaves the IF open for the real pull.
      const stillOpen = pickSizeKeys(next).some(sz => (next[sz] || 0) > 0);
      if (!stillOpen) { next.status = 'pulled'; if (!next.pulled_at) next.pulled_at = stamp }
      return next;
    });
    return { ...it, pick_lines: pickLines };
  });
  if (units === 0) return null;
  return { items: newItems, declared, units, sizes: [...new Set(declared.map(d => d.size))] };
};

// Zeroed inventory map for one product, given the sizes just declared not here.
// Returns {next, deltas} or null when the product already reads 0 for all of them.
export const zeroInventoryFor = (product, sizes) => {
  if (!product) return null;
  const inv = product._inv || {};
  const next = { ...inv }; const deltas = {};
  (sizes || []).forEach(sz => {
    const cur = Number(inv[sz]) || 0;
    if (cur === 0) return;
    next[sz] = 0; deltas[sz] = -cur;
  });
  return Object.keys(deltas).length ? { next, deltas } : null;
};

// The non-size fields the direct pick-line DB write has to be handed back, or it erases
// them from the sizes JSONB it replaces (see _dbUpdatePickLineStatus).
export const pickPersistMeta = pick => {
  const out = {};
  ['not_here', 'not_here_at', 'not_here_by'].forEach(k => { if (pick && pick[k] != null) out[k] = pick[k] });
  return out;
};

// Every size on an IF that was declared not here, for display.
export const notHereSummary = (so, ifId) => {
  const out = {};
  ifEntries(so, ifId).forEach(({ item, pick }) => {
    Object.entries(pick.not_here || {}).forEach(([sz, qty]) => {
      if (!(qty > 0)) return;
      const key = item.sku || item.name || 'Item';
      (out[key] || (out[key] = {}))[sz] = ((out[key] || {})[sz] || 0) + qty;
    });
  });
  return out;
};
