// ── MOVE CHECK-IN (September building move) — pure helpers ────────────────────
// Companion to src/boxTracking.js: every physical box entering the new building
// gets scanned (existing BX QR labels) or hand-entered (legacy boxes, which then
// get a printed BX label so they're scannable from that point on). Check-in and
// shelf placement live on the existing `boxes` table (checked_in_at/checked_in_by
// + the bin column reserved by BOX_TRACKING_PLAN.md's bin phase).
// Pure (no supabase, no window) so it unit-tests directly; MoveCheckIn.js owns
// persistence and UI.
import { isBoxCode, makeBoxRow } from '../boxTracking';

// Classify a camera read / manual entry. Printed labels encode a ?scan= URL,
// bare plates come from hand-typing; anything that isn't a BX plate is a
// reference off an old pre-plate label (IF-1071, NSA-4501, SO-…) or free text.
//   → {type:'box', id:'BX-2001'} | {type:'ref', id:'IF-1071'} | {type:'empty'}
export const classifyMoveScan = (raw) => {
  let v = String(raw == null ? '' : raw).trim();
  if (!v) return { type: 'empty' };
  if (/^https?:\/\//i.test(v)) {
    const m = v.match(/[?&]scan=([^&#]+)/i);
    if (m) { try { v = decodeURIComponent(m[1]); } catch (e) { v = m[1]; } }
  }
  v = v.trim();
  if (!v) return { type: 'empty' };
  // tolerate "bx2001" / "bx 2001" hand-typing
  const bare = v.replace(/^bx[\s-]*/i, '');
  if (/^bx/i.test(v) && /^[A-Z0-9]+$/i.test(bare)) v = 'BX-' + bare.toUpperCase();
  if (isBoxCode(v)) return { type: 'box', id: v.toUpperCase() };
  return { type: 'ref', id: v };
};

// Boxes matching a non-plate reference from an old (pre-BX) label: IF#, PO#, or
// SO# — checked against the convenience refs and source_refs. Case-insensitive.
export const boxesForRef = (boxes, ref) => {
  const r = String(ref || '').trim().toUpperCase();
  if (!r) return [];
  return (boxes || []).filter((b) => {
    if (!b || b.status === 'combined') return false;
    if ([b.if_id, b.po_id, b.so_id].some((x) => String(x || '').toUpperCase() === r)) return true;
    return (b.source_refs || []).some((s) => String((s && s.id) || '').toUpperCase() === r);
  });
};

// Contents lines for a hand-entered legacy box. One item per line, quantity
// optional in either "3 x navy hoodies" / "3 navy hoodies" / "navy hoodies x3"
// form; no sizes are known, so quantity rides in sizes.EA (boxUnits and the
// label's unit count then come out right).
export const parseLegacyItems = (text) => {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      let qty = 1; let name = l;
      let m = l.match(/^(\d+)\s*[xX×]?\s+(.+)$/);
      if (m) { qty = +m[1]; name = m[2]; }
      else if ((m = l.match(/^(.+?)\s*[xX×]\s*(\d+)$/))) { name = m[1]; qty = +m[2]; }
      return { sku: '', name: name.trim(), color: '', sizes: { EA: qty > 0 ? qty : 1 } };
    })
    .filter((e) => e.name);
};

// Row for a hand-entered legacy box: a real boxes-table row (same shape as
// makeBoxRow) that is already checked in, with the move-specific columns set.
// assign: 'job' (soId required) | 'inventory'.
export const makeLegacyMoveBox = ({ plate, assign, soId = null, items = [], bin = null, createdBy = null, now = new Date().toISOString() }) => ({
  ...makeBoxRow({ id: plate, kind: 'legacy', contents: items, soId: assign === 'job' ? soId : null, createdBy, now }),
  assigned_to: assign === 'job' ? 'job' : 'inventory',
  bin: bin || null,
  checked_in_at: now,
  checked_in_by: createdBy,
});

// Shelf codes are free text ("A3", "RACK 12", or a scanned shelf barcode) —
// trimmed + uppercased so "a3" and "A3 " land in the same bin.
export const normShelf = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, ' ');

// ── inventory count → submit (the move IS the new stocktake) ─────────────────
// Only boxes assigned to INVENTORY count — SO/IF fulfillment boxes are customer
// goods, not house stock. A box counts once it's checked in and not combined.
export const isCountedInventoryBox = (b) =>
  !!(b && b.checked_in_at && b.status !== 'combined' && b.assigned_to === 'inventory');

// Tally SKU×size across all counted inventory boxes.
//   → { 'SKU123': { sku, product_id (when any entry carried one), sizes:{S:4,M:2} } }
// Keyed by uppercased SKU; entries with no SKU land under '' (surfaced by
// buildSubmitPlan as unmatched so they're never silently dropped).
export const inventoryTally = (boxes) => {
  const out = {};
  (boxes || []).filter(isCountedInventoryBox).forEach((b) => {
    (b.contents || []).forEach((e) => {
      if (!e) return;
      const key = String(e.sku || '').trim().toUpperCase();
      const t = out[key] || (out[key] = { sku: key, product_id: null, name: e.name || '', sizes: {} });
      if (e.product_id && !t.product_id) t.product_id = e.product_id;
      if (!t.name && e.name) t.name = e.name;
      Object.entries(e.sizes || {}).forEach(([sz, v]) => {
        const n = +v || 0;
        if (n > 0) t.sizes[sz] = (t.sizes[sz] || 0) + n;
      });
    });
  });
  return out;
};

// Build the submit review: what gets set to the counted numbers, what has
// portal stock today but was never scanned over (zero-out candidates — the
// user confirms each list before anything writes), and counted SKUs that don't
// match any product (must be fixed, never silently dropped).
//   tally    — from inventoryTally
//   invRows  — product_inventory rows [{product_id,size,quantity}]
//   products — [{id,sku,name,color}] covering at least the involved products
// For a counted product, sizes it has in product_inventory but NOT in the
// count are included at 0 (merge_product_inventory leaves unsent sizes
// untouched, and a stocktake must not).
export const buildSubmitPlan = (tally, invRows, products) => {
  const bySku = {}; const byId = {};
  (products || []).forEach((p) => { if (!p) return; bySku[String(p.sku || '').trim().toUpperCase()] = p; byId[p.id] = p; });
  const invByProduct = {};
  (invRows || []).forEach((r) => {
    if (!r) return;
    const m = invByProduct[r.product_id] || (invByProduct[r.product_id] = {});
    m[r.size] = +r.quantity || 0;
  });
  const counted = []; const unmatched = [];
  const countedIds = new Set();
  Object.values(tally || {}).forEach((t) => {
    const p = (t.product_id && byId[t.product_id]) || bySku[t.sku];
    if (!p) { unmatched.push(t); return; }
    countedIds.add(p.id);
    const existing = invByProduct[p.id] || {};
    const sizes = { ...t.sizes };
    Object.keys(existing).forEach((sz) => { if (!(sz in sizes)) sizes[sz] = 0; });
    const rows = Object.entries(sizes).map(([size, q]) => ({ size, quantity: q, oldQty: existing[size] || 0 }));
    counted.push({ product_id: p.id, sku: p.sku, name: p.name, color: p.color || '', rows, units: rows.reduce((a, r) => a + r.quantity, 0) });
  });
  const zeroCandidates = Object.entries(invByProduct)
    .filter(([pid, m]) => !countedIds.has(pid) && Object.values(m).some((q) => q > 0))
    .map(([pid, m]) => {
      const p = byId[pid] || {};
      return { product_id: pid, sku: p.sku || pid, name: p.name || '', color: p.color || '', rows: Object.entries(m).map(([size, q]) => ({ size, quantity: 0, oldQty: q })), oldUnits: Object.values(m).reduce((a, q) => a + q, 0) };
    });
  const sortSku = (a, b) => String(a.sku).localeCompare(String(b.sku));
  counted.sort(sortSku); zeroCandidates.sort(sortSku); unmatched.sort(sortSku);
  return { counted, zeroCandidates, unmatched };
};

// Move-progress rollup for the header + Boxes tab.
export const moveStats = (boxes, todayStart) => {
  const live = (boxes || []).filter((b) => b && b.status !== 'combined');
  const checked = live.filter((b) => b.checked_in_at);
  return {
    checkedIn: checked.length,
    today: todayStart ? checked.filter((b) => b.checked_in_at >= todayStart).length : 0,
    unshelved: checked.filter((b) => !b.bin).length,
    notCheckedIn: live.filter((b) => !b.checked_in_at && b.status !== 'shipped').length,
  };
};
