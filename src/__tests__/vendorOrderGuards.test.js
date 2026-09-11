import { collapseVendorLines, reconcileVendorLines } from '../lib/vendorOrderGuards';
import { buildSSOrderPayload } from '../ssOrder';

// The regression these guards exist for. Batch NSA 4632 (SO-2277, 2026-09-01) queued every
// line twice; the S&S payload carried each Sku twice; S&S ADDED them and invoiced 2x.
const nsa4632AT203 = [
  { key: 'AT203|Black/ White|M', style: 'AT203', color: 'Black/ White', size: 'M', sku: 'B029F8504', quantity: 3, unitPrice: 25.17, sourceSO: 'SO-2277' },
  { key: 'AT203|Black/ White|L', style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 4, unitPrice: 25.17, sourceSO: 'SO-2277' },
  { key: 'AT203|Black/ White|M', style: 'AT203', color: 'Black/ White', size: 'M', sku: 'B029F8504', quantity: 3, unitPrice: 25.17, sourceSO: 'SO-2277' },
  { key: 'AT203|Black/ White|L', style: 'AT203', color: 'Black/ White', size: 'L', sku: 'B029F8505', quantity: 4, unitPrice: 25.17, sourceSO: 'SO-2277' },
];

describe('collapseVendorLines', () => {
  test('collapses a repeated vendor item number into one line and reports it', () => {
    const { merged, duplicates } = collapseVendorLines(nsa4632AT203, l => l.sku);
    expect(merged).toHaveLength(2);
    expect(merged.map(m => [m.key, m.quantity])).toEqual([['B029F8504', 6], ['B029F8505', 8]]);
    expect(duplicates).toHaveLength(2);
    expect(duplicates[0].parts.map(p => p.quantity)).toEqual([3, 3]);
    expect(duplicates[0].parts[0].sourceSO).toBe('SO-2277');
  });

  test('collapsing never changes the total unit count', () => {
    const { sentUnits, mergedUnits } = collapseVendorLines(nsa4632AT203, l => l.sku);
    expect(sentUnits).toBe(14);
    expect(mergedUnits).toBe(sentUnits);
  });

  test('merges the same SKU across two sales orders and labels both sources', () => {
    const { merged, duplicates } = collapseVendorLines([
      { style: 'AT203', color: 'Black', size: 'L', sku: 'B1', quantity: 2, sourceSO: 'SO-1' },
      { style: 'AT203', color: 'Black', size: 'L', sku: 'B1', quantity: 3, sourceSO: 'SO-2' },
    ], l => l.sku);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(5);
    expect(duplicates[0].parts.map(p => p.sourceSO)).toEqual(['SO-1', 'SO-2']);
  });

  test('distinct SKUs are left alone and report no duplicates', () => {
    const { merged, duplicates } = collapseVendorLines([
      { sku: 'B1', quantity: 2 }, { sku: 'B2', quantity: 3 },
    ], l => l.sku);
    expect(merged).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  // The modal shows a harder warning when every part of a merge comes from ONE sales order:
  // that is a duplicated batch queue, not two orders wanting the same blank.
  const singleSourced = d => new Set(d.parts.map(p => p.sourceSO || '')).size === 1;

  test('a duplicated queue reads as single-sourced; a cross-SO merge does not', () => {
    const { duplicates: dup } = collapseVendorLines(nsa4632AT203, l => l.sku);
    expect(dup.every(singleSourced)).toBe(true);

    const { duplicates: crossSo } = collapseVendorLines([
      { sku: 'B1', quantity: 2, sourceSO: 'SO-1' },
      { sku: 'B1', quantity: 3, sourceSO: 'SO-2' },
    ], l => l.sku);
    expect(crossSo.some(singleSourced)).toBe(false);
  });

  test('skips blank keys and non-positive quantities', () => {
    const { merged } = collapseVendorLines([
      { sku: '', quantity: 5 }, { sku: 'B1', quantity: 0 }, { sku: 'B2', quantity: 2 },
    ], l => l.sku);
    expect(merged.map(m => m.key)).toEqual(['B2']);
  });
});

describe('buildSSOrderPayload', () => {
  const ship = { companyName: 'NSA', address1: '210 E Emerson', city: 'Orange', region: 'CA', postalCode: '92865' };

  test('sends ONE S&S line per Sku — a duplicated queue can no longer double the order', () => {
    const built = buildSSOrderPayload({ poNumber: 'NSA 4632', lineItems: nsa4632AT203, shipTo: ship, testOrder: false });
    expect(built.order.lines).toEqual([
      { identifier: 'B029F8504', qty: 6 },
      { identifier: 'B029F8505', qty: 8 },
    ]);
    // S&S would have summed these anyway — the point is that the modal now knows it happened.
    expect(built.duplicates).toHaveLength(2);
  });

  test('summary still reports the portal-line view the rep is reading', () => {
    const built = buildSSOrderPayload({ poNumber: 'NSA 4632', lineItems: nsa4632AT203, shipTo: ship, testOrder: false });
    expect(built.summary.lineCount).toBe(4);
    expect(built.summary.totalQty).toBe(14);
  });

  test('a clean order reports no duplicates and is unchanged', () => {
    const clean = [{ style: 'A515', color: 'Black', size: 'M', sku: 'B05753504', quantity: 1, unitPrice: 28.13 }];
    const built = buildSSOrderPayload({ poNumber: 'NSA 4632', lineItems: clean, shipTo: ship, testOrder: false });
    expect(built.order.lines).toEqual([{ identifier: 'B05753504', qty: 1 }]);
    expect(built.duplicates).toHaveLength(0);
  });
});

describe('reconcileVendorLines', () => {
  const sent = [
    { sku: 'B029F8505', style: 'AT203', color: 'Black/ White', size: 'L', quantity: 8, sourceSO: 'SO-2277' },
    { sku: 'B029F8706', style: 'AT203', color: 'Team Power Red/ White', size: 'XL', quantity: 8, sourceSO: 'SO-2277' },
  ];

  test('flags a line S&S dropped silently — NSA 4632 AT203 Team Power Red', () => {
    const r = reconcileVendorLines(sent, { raw: { lines: [{ sku: 'B029F8505', qty: 8 }] } }, l => l.sku);
    expect(r.verified).toBe(false);
    expect(r.checkedAgainst).toBe('lines');
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].label).toBe('AT203 Team Power Red/ White XL');
    expect(r.missing[0].sent).toBe(8);
  });

  test('flags a partially-accepted line', () => {
    const r = reconcileVendorLines(sent, { raw: { lines: [{ sku: 'B029F8505', qty: 8 }, { sku: 'B029F8706', qty: 3 }] } }, l => l.sku);
    expect(r.missing).toHaveLength(0);
    expect(r.short).toEqual([expect.objectContaining({ sent: 8, accepted: 3 })]);
    expect(r.verified).toBe(false);
  });

  test('a fully-accepted order verifies', () => {
    const r = reconcileVendorLines(sent, { raw: { lines: [{ sku: 'B029F8505', qty: 8 }, { sku: 'B029F8706', qty: 8 }] } }, l => l.sku);
    expect(r.verified).toBe(true);
    expect(r.missing).toHaveLength(0);
  });

  test('reads lines out of an array-of-orders response (S&S PascalCase)', () => {
    const r = reconcileVendorLines(sent, { raw: [{ OrderNumber: '75771511', Lines: [{ Identifier: 'B029F8505', Qty: 8 }, { Identifier: 'B029F8706', Qty: 8 }] }] }, l => l.sku);
    expect(r.verified).toBe(true);
  });

  test('no line detail is reported as unverified, NOT as a drop', () => {
    const r = reconcileVendorLines(sent, { raw: { orderNumber: '75771511' } }, l => l.sku);
    expect(r.checkedAgainst).toBe('errors-only');
    expect(r.verified).toBe(false);
    expect(r.missing).toEqual([]);   // never claim a drop we did not observe
    expect(r.short).toEqual([]);
  });

  test('surfaces vendor line errors even when an order number came back', () => {
    const r = reconcileVendorLines(sent, { lineErrors: [{ error: 'B029F8706 is discontinued' }], raw: { orderNumber: '75771511' } }, l => l.sku);
    expect(r.lineErrors).toEqual(['B029F8706 is discontinued']);
    expect(r.verified).toBe(false);
  });
});
