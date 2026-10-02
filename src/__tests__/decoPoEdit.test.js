import { reviseDecoPO, decoPoEditTotals } from '../lib/decoPoEdit';
import { isDecoOutsourced } from '../businessLogic';

const po = { id: 'dp1', po_id: 'DPO 1', vendor: 'Astra', po_mode: 'send_items', deco_type: 'heat_transfer', item_idxs: [0], art_file_ids: ['patch'], qty: 50, unit_cost: 2, expected_cost: 100, _bill_cost: 90, _bill_details: [{ doc: 'B1' }], tracking_numbers: ['1Z123'] };
const order = () => ({ deco_pos: [po], items: [{ decorations: [{ kind: 'art', art_file_id: 'patch', fulfillment: 'outside', vendor: 'Astra', deco_po_id: 'DPO 1', _outside_sell: true, sell_override: 4 }] }], art_files: [{ id: 'patch', deco_type: 'heat_transfer', status: 'approved', prod_files: [] }], jobs: [{ id: 'J1', art_file_id: 'patch', art_status: 'approved', prod_status: 'hold', coach_approved_at: 'kept' }] });
const opts = { now: '2026-10-02T15:00:00Z', artStatusForFile: a => a.prod_files_attached ? 'art_complete' : 'approved', activeProd: s => s === 'in_progress' };

test('correcting outside decoration to materials restores in-house routing and retains financial history', () => {
  const o = order();
  const updated = reviseDecoPO(o, po, { po_mode: 'dtf_purchase', qty: 165, expected_cost: 330 }, opts);
  expect(isDecoOutsourced(updated, 0, updated.items[0].decorations[0])).toBe(false);
  expect(updated.items[0].decorations[0].sell_override).toBeUndefined();
  expect(updated.deco_pos[0]).toMatchObject({ qty: 165, _bill_cost: 90, _bill_details: [{ doc: 'B1' }], tracking_numbers: ['1Z123'] });
  expect(updated.art_files[0].dtf_purchased.po_id).toBe('DPO 1');
  expect(updated.jobs[0]).toMatchObject({ id: 'J1', art_status: 'art_complete', coach_approved_at: 'kept' });
  expect(o.items[0].decorations[0].fulfillment).toBe('outside');
});

test('switching back removes only this purchase marker and respects active jobs', () => {
  const purchase = reviseDecoPO(order(), po, { po_mode: 'dtf_purchase' }, opts);
  purchase.art_files[0].prod_files.push({ name: 'Real artwork.pdf' });
  purchase.jobs[0].prod_status = 'in_progress';
  const updated = reviseDecoPO(purchase, purchase.deco_pos[0], { po_mode: 'send_items' }, opts);
  expect(updated.art_files[0].prod_files).toEqual([{ name: 'Real artwork.pdf' }]);
  expect(updated.art_files[0].dtf_purchased).toBeUndefined();
  expect(updated.jobs[0]).toEqual(purchase.jobs[0]);
  expect(isDecoOutsourced(updated, 0, updated.items[0].decorations[0])).toBe(true);
});

test('renaming a purchase updates markers while preserving other files and purchases', () => {
  const purchase = reviseDecoPO(order(), po, { po_mode: 'dtf_purchase' }, opts);
  const updated = reviseDecoPO(purchase, purchase.deco_pos[0], { po_id: 'DPO 2', vendor: 'New Vendor' }, opts);
  expect(updated.art_files[0].dtf_purchased).toMatchObject({ po_id: 'DPO 2', vendor: 'New Vendor' });
  expect(updated.art_files[0].prod_files).toHaveLength(1);
  expect(updated.art_files[0].prod_files[0].po_id).toBe('DPO 2');
});

test('another garment PO keeps its routing when coverage is removed', () => {
  const o = order();
  o.deco_pos.push({ ...po, id: 'dp2', po_id: 'DPO 2' });
  const updated = reviseDecoPO(o, po, { po_mode: 'dtf_purchase' }, opts);
  expect(isDecoOutsourced(updated, 0, updated.items[0].decorations[0])).toBe(true);
});

test('removing coverage clears soft routing for this PO without touching other linked decorations', () => {
  const o = order();
  o.items[0].decorations.push({ kind: 'numbers', num_method: 'heat_transfer', deco_po_id: 'DPO OTHER', fulfillment: 'outside', vendor: 'Astra' });
  const updated = reviseDecoPO(o, po, { item_idxs: [] }, opts);
  expect(updated.items[0].decorations[0].fulfillment).toBeUndefined();
  expect(updated.items[0].decorations[1]).toEqual(o.items[0].decorations[1]);
});

test('another materials purchase maintains the art gate when this purchase changes purpose', () => {
  const purchase = reviseDecoPO(order(), po, { po_mode: 'dtf_purchase' }, opts);
  purchase.deco_pos.push({ ...purchase.deco_pos[0], id: 'dp2', po_id: 'DPO 2' });
  const updated = reviseDecoPO(purchase, purchase.deco_pos[0], { po_mode: 'send_items' }, opts);
  expect(updated.art_files[0].dtf_purchased.po_id).toBe('DPO 2');
  expect(updated.jobs[0].art_status).toBe('art_complete');
});

test('manual purchase quantities do not require garment coverage; outside conversions do', () => {
  const o = order();
  const purchase = { ...po, po_mode: 'dtf_purchase', item_idxs: [], art_file_ids: [] };
  o.deco_pos = [purchase];
  expect(reviseDecoPO(o, purchase, { qty: 165 }, opts).deco_pos[0].qty).toBe(165);
  expect(() => reviseDecoPO(o, purchase, { po_mode: 'send_items' }, opts)).toThrow('Edit Items');
});

test('invalid costs, duplicate numbers and art-service conversions fail before saving', () => {
  const o = order();
  expect(() => reviseDecoPO(o, po, { qty: NaN }, opts)).toThrow('valid');
  expect(() => reviseDecoPO(o, po, { unit_cost: -1 }, opts)).toThrow('valid');
  o.deco_pos.push({ ...po, id: 'dp2', po_id: 'DPO 2' });
  expect(() => reviseDecoPO(o, po, { po_id: 'DPO 2' }, opts)).toThrow('already exists');
  expect(() => reviseDecoPO(o, { ...po, topstar_service: 'dst' }, { po_mode: 'dtf_purchase' }, opts)).toThrow('art-service');
});

test('purchase totals preserve mixed rates and use an independent material quantity', () => {
  const previous = { ...po, item_idxs: [0, 1], qty: 100, unit_cost: 0, item_costs: { 0: 8.61, 1: 8.61 } };
  const items = [{ sizes: { M: 50 } }, { sizes: { M: 50 } }];
  expect(decoPoEditTotals(previous, { po_mode: 'dtf_purchase', qty: '100', unit_cost: '0' }, items)).toEqual({ qty: 100, unit_cost: 0, expected_cost: 861 });
  expect(decoPoEditTotals(previous, { po_mode: 'dtf_purchase', qty: '165', unit_cost: '0' }, items).expected_cost).toBe(1420.65);
  expect(decoPoEditTotals({ ...po, po_mode: 'dtf_purchase', qty: 165 }, { po_mode: 'send_items', unit_cost: '2' }, items).qty).toBe(50);
});
