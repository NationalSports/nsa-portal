// Source quantities are checked before a regular batch may consume durable
// All School allocations. A preview may not drop a short line or redirect it.
const { shipFromLocation } = require('./shipFrom');
const norm = value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
function allSchoolWarehouseDestination() {
  const w = shipFromLocation('warehouse');
  return { companyName: w.company || w.name, address1: w.street1, address2: w.street2 || '', city: w.city, region: w.state, postalCode: w.zip, country: 'US' };
}
function allSchoolSourceLines(positions) {
  return positions.flatMap(bp => (bp.items || []).flatMap(it => Object.entries(it.sizes || {}).map(([size, quantity]) => ({ sourceBatchId: bp.id, sourceItemIdx: it.item_idx, size, quantity }))));
}
function validateAllSchoolBatch({ positions = [], lines = [], payload }) {
  const school = positions.filter(p => p.all_school_allocation_id);
  if (!school.length) return { ok: true };
  const expected = {}, actual = {};
  const key = (batch, item, size) => JSON.stringify([batch, Number(item), String(size).trim().toUpperCase()]);
  for (const bp of school) for (const it of bp.items || []) for (const [size, qty] of Object.entries(it.sizes || {})) {
    const k = key(bp.id, it.item_idx, size); expected[k] = (expected[k] || 0) + Number(qty || 0);
  }
  const ids = new Set(school.map(p => p.id));
  for (const l of lines) if (ids.has(l.sourceBatchId)) {
    const k = key(l.sourceBatchId, l.sourceItemIdx, l.size); actual[k] = (actual[k] || 0) + Number(l.quantity || 0);
  }
  if (Object.keys(expected).length !== Object.keys(actual).length || Object.keys(expected).some(k => expected[k] !== actual[k])) return { ok: false, reason: 'All School quantities changed in the supplier preview. Reload the batch before ordering.' };
  const w = shipFromLocation('warehouse');
  const ship = payload?.PO?.shipment?.shipTo || payload?.shippingAddress || {};
  const address = ship.address1 || ship.address;
  const expectedAddress = payload?.PO ? w.street1 : [w.street1, w.street2].filter(Boolean).join(' ');
  if (norm(address) !== norm(expectedAddress) || norm(ship.city) !== norm(w.city) || norm(ship.region || ship.state) !== norm(w.state) || norm(ship.postalCode || ship.zip) !== norm(w.zip) || (payload?.PO && norm(ship.address2) !== norm(w.street2))) return { ok: false, reason: 'All School blank garments must ship to the Orange warehouse. Restore the warehouse address before ordering.' };
  return { ok: true };
}
module.exports = { validateAllSchoolBatch, allSchoolWarehouseDestination, allSchoolSourceLines };
