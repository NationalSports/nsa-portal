const fs = require('fs');
const path = require('path');
const {
  isGarmentDecoPO, outsourcedDecoTypes, isDecoOutsourced, jobAllRoutedOutside,
  safeItems, safeDecos,
} = require('../businessLogic');

const purchase = { po_id: 'DPO 59364 RBVBS', po_mode: 'dtf_purchase', vendor: 'Astra Sport', deco_type: 'heat_transfer', item_idxs: [0, 2] };
const order = () => ({
  id: 'SO-2222',
  art_files: [{ id: 'patch', deco_type: 'heat_transfer' }],
  items: [0, 1, 2].map(i => ({ decorations: [
    { kind: 'art', art_file_id: 'patch' },
    ...(i === 1 ? [] : [{ kind: 'numbers', num_method: 'heat_transfer' }]),
  ] })),
  deco_pos: [purchase],
});

test('patch purchase leaves the complete heat-press run in-house and does not retire it', () => {
  const o = order();
  expect(outsourcedDecoTypes(o)).toEqual({});
  o.items.forEach((it, ii) => it.decorations.forEach(d => expect(isDecoOutsourced(o, ii, d)).toBe(false)));
  const job = { items: [0, 2].map(item_idx => ({ item_idx, deco_idxs: [0, 1] })) };
  expect(jobAllRoutedOutside(o, job)).toBe(false);
  expect(o.deco_pos).toEqual([purchase]);
});

test('actual garment POs still outsource and protect coverage, including legacy POs', () => {
  for (const mode of ['send_items', undefined]) {
    const o = order();
    o.deco_pos.push({ ...purchase, po_id: 'DPO GARMENTS', po_mode: mode });
    expect(isGarmentDecoPO(o.deco_pos[1])).toBe(true);
    expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(true);
    expect(jobAllRoutedOutside(o, { items: [{ item_idx: 0, deco_idxs: [0, 1] }] })).toBe(true);
  }
});

test('a materials purchase does not override an explicit outside routing choice', () => {
  const o = order();
  o.items[0].decorations[0].fulfillment = 'outside';
  expect(isDecoOutsourced(o, 0, o.items[0].decorations[0])).toBe(true);
  expect(isDecoOutsourced(o, 2, o.items[2].decorations[0])).toBe(false);
  expect(isGarmentDecoPO({ ...purchase, po_mode: 'send_items', topstar_service: 'dst' })).toBe(false);
});

describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s bulk routing', file => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const body = src.slice(src.indexOf('const _markDecoRows=()=>'), src.indexOf('const openMarkDeco='))
    .replace('const _markDecoRows=', 'return ');
  const rows = o => new Function('o', 'isSO', 'safeItems', 'safeDecos', 'isGarmentDecoPO', body)(o, true, safeItems, safeDecos, isGarmentDecoPO)();

  test('purchase-covered lines show In-house and are available to mark back in-house', () => {
    expect(rows(order()).every(r => r.markable && !r.outside && !r.dp)).toBe(true);
    const o = order();
    o.items[0].decorations[0].fulfillment = 'outside';
    expect(rows(o)[0]).toMatchObject({ outside: true, dp: undefined });
  });

  test('a garment PO still blocks moving its covered lines back in-house', () => {
    const o = order();
    o.deco_pos.push({ ...purchase, po_id: 'DPO GARMENTS', po_mode: 'send_items' });
    expect(rows(o)[0]).toMatchObject({ outside: true, dp: { po_id: 'DPO GARMENTS' } });
    expect(rows(o)[1]).toMatchObject({ outside: false, dp: undefined });
  });
});
