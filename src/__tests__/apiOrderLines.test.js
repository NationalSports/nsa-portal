import { apiLineSourceKey, apiVerificationForPoLine, removeApiLineFromBatchPOs, removeApiLineFromPoItems } from '../lib/apiOrderLines';
import { buildSanMarLineItems } from '../sanmarPO';

const po = { po_id: 'PO 58989 GHBSB', vendor: 'SanMar', status: 'waiting', received: {}, shipments: [], S: 8, M: 36 };
const items = [{ sku: 'ST420', color: 'Forest Green', po_lines: [po] }];

test('SanMar lines retain the exact SO, PO, batch, item, and SKU source', () => {
  const { lines } = buildSanMarLineItems([{ id: 'BPO-1', so_id: 'SO-2306', po_id: po.po_id, items: [{ item_idx: 0, sku: 'ST420', color: 'Forest Green', sizes: { S: 8 }, unit_cost: 17.25 }] }]);
  expect(lines[0]).toMatchObject({ sourceSO: 'SO-2306', sourcePO: po.po_id, sourceBatchId: 'BPO-1', sourceItemIdx: 0, sourceSku: 'ST420', sourceColor: 'Forest Green', size: 'S', quantity: 8 });
});

test('source identity survives display-line renumbering after an earlier line is removed', () => {
  const source = { lineNumber: 5, sourceSO: 'SO-2306', sourcePO: po.po_id, sourceBatchId: 'BPO-1', sourceItemIdx: 2, sourceSku: 'ST350', sourceColor: 'Forest Green', size: 'L' };
  expect(apiLineSourceKey(source)).toBe(apiLineSourceKey({ ...source, lineNumber: 1 }));
  expect(apiLineSourceKey(source)).not.toBe(apiLineSourceKey({ ...source, size: 'XL' }));
  expect(apiLineSourceKey({ ...source, sourceItemIdx: 0 })).not.toBe(apiLineSourceKey({ ...source, sourceItemIdx: 1 }));
});

test('builds the exact three-style SanMar order confirmed by PO 58989', () => {
  const confirmed = [{
    id: 'BPO-CONFIRMED', so_id: 'SO-2306', po_id: 'PO 58989 GHBSB', items: [
      { item_idx: 0, sku: 'ST550', color: 'Black', sizes: { S: 10, M: 36, L: 23, XL: 4, '2XL': 2 }, unit_cost: 7.26, _size_costs: { '2XL': 8.26 } },
      { item_idx: 1, sku: 'ST420', color: 'Black', sizes: { S: 14, M: 44, L: 34, XL: 5, '2XL': 3 }, unit_cost: 5.57, _size_costs: { '2XL': 6.57 } },
      { item_idx: 2, sku: 'ST350', color: 'Forest Green', sizes: { S: 14, M: 44, L: 34, XL: 5, '2XL': 3 }, unit_cost: 3.88, _size_costs: { '2XL': 4.82 } },
    ],
  }];
  const { lines } = buildSanMarLineItems(confirmed);
  const qtyFor = style => lines.filter(line => line.style === style).reduce((sum, line) => sum + line.quantity, 0);

  expect(lines).toHaveLength(15);
  expect(qtyFor('ST550')).toBe(75);
  expect(qtyFor('ST420')).toBe(100);
  expect(qtyFor('ST350')).toBe(100);
  expect(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)).toBeCloseTo(1497.32, 2);
  expect(lines.every(line => line.sourcePO === 'PO 58989 GHBSB')).toBe(true);
});

test('removing an unavailable API size reduces the source PO but keeps the SO item', () => {
  const result = removeApiLineFromPoItems(items, { sourcePO: po.po_id, sourceItemIdx: 0, sourceSku: 'ST420', sourceColor: 'Forest Green', size: 'S', quantity: 8 });
  expect(result.removed).toBe(true);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].po_lines[0].S).toBeUndefined();
  expect(result.items[0].po_lines[0].M).toBe(36);
});

test('the last removed size removes only the PO line, not the sales-order item', () => {
  const result = removeApiLineFromPoItems([{ ...items[0], po_lines: [{ ...po, M: undefined }] }], { sourcePO: po.po_id, sourceItemIdx: 0, size: 'S', quantity: 8 });
  expect(result.removed).toBe(true);
  expect(result.items).toHaveLength(1);
  expect(result.items[0].po_lines).toHaveLength(0);
});

test('a line with vendor acceptance history cannot be removed', () => {
  const result = removeApiLineFromPoItems([{ ...items[0], po_lines: [{ ...po, api_order_id: 'TX-1' }] }], { sourcePO: po.po_id, sourceItemIdx: 0, size: 'S', quantity: 8 });
  expect(result.removed).toBe(false);
  expect(result.reason).toMatch(/already has API/);
});

test('a partially recorded legacy API stamp also blocks removal', () => {
  const result = removeApiLineFromPoItems([{ ...items[0], po_lines: [{ ...po, vendor_keys: { order_no: 'TX-OLD' } }] }], { sourcePO: po.po_id, sourceItemIdx: 0, size: 'S', quantity: 8 });
  expect(result.removed).toBe(false);
});

test('removing a size updates the queued batch quantity and cost', () => {
  const batches = [{ id: 'BPO-1', items: [{ item_idx: 0, sku: 'ST420', color: 'Forest Green', sizes: { S: 8, M: 2 }, qty: 10, unit_cost: 17.25 }], total_cost: 172.5 }];
  const next = removeApiLineFromBatchPOs(batches, { sourceBatchId: 'BPO-1', sourceItemIdx: 0, size: 'S', quantity: 8 });
  expect(next[0].items[0]).toMatchObject({ sizes: { M: 2 }, qty: 2 });
  expect(next[0].total_cost).toBe(34.5);
});

test('API verification reports accepted quantities and predicted warehouses by size', () => {
  const verification = apiVerificationForPoLine(items[0], { ...po, api_order_id: 'TX-1', vendor_keys: { lines: [
    { style: 'ST420', size: 'S', qty: 8, warehouse: 'Reno, NV' },
    { style: 'ST420', size: 'M', qty: 36, warehouse: 'Reno, NV' },
  ] } });
  expect(verification.accepted).toBe(true);
  expect(verification.verified).toBe(true);
  expect(verification.bySize.S).toEqual({ quantity: 8, warehouses: ['Reno, NV'] });
  expect(verification.bySize.M.quantity).toBe(36);
});

test('API verification flags the reported 75-versus-100 quantity mismatch', () => {
  const verification = apiVerificationForPoLine(
    { sku: 'ST420', color: 'Forest Green' },
    { ...po, S: 20, M: 40, L: 30, XL: 8, '2XL': 2, api_order_id: 'TX-2', vendor_keys: { lines: [
      { style: 'ST420', size: 'S', qty: 8, warehouse: 'Reno, NV' },
      { style: 'ST420', size: 'M', qty: 36, warehouse: 'Reno, NV' },
      { style: 'ST420', size: 'L', qty: 24, warehouse: 'Reno, NV' },
      { style: 'ST420', size: 'XL', qty: 6, warehouse: 'Reno, NV' },
      { style: 'ST420', size: '2XL', qty: 1, warehouse: 'Reno, NV' },
    ] } },
  );

  expect(Object.values(verification.expectedBySize).reduce((sum, qty) => sum + qty, 0)).toBe(100);
  expect(Object.values(verification.bySize).reduce((sum, entry) => sum + entry.quantity, 0)).toBe(75);
  expect(verification.accepted).toBe(true);
  expect(verification.verified).toBe(false);
  expect(verification.discrepancies).toEqual(expect.arrayContaining([
    { size: 'S', expected: 20, recorded: 8 },
    { size: 'M', expected: 40, recorded: 36 },
  ]));
});

test('a legacy API id is acknowledged but not falsely called size-verified', () => {
  const verification = apiVerificationForPoLine(items[0], { ...po, api_order_id: 'LEGACY-1' });
  expect(verification.accepted).toBe(true);
  expect(verification.hasLineDetail).toBe(false);
  expect(verification.verified).toBe(false);
});
