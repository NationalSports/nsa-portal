// The deco PO's quantity is a snapshot of what was committed to the vendor, so
// "what do the covered items total right now" is the number both the PO page's own
// Sync button and the reconciliation panel write. One definition, tested here.

import { decoPoRows, decoPoTotals, decoPoDrift } from '../lib/decoPoUnits';

const items = [
  { sku: 'A', sizes: { S: 2, M: 3 } },
  { sku: 'B', sizes: { L: 1 } },
  { sku: 'C', sizes: { XL: 9 } },
];

describe('deco PO live totals', () => {
  test('counts only the items the PO covers', () => {
    const dp = { po_id: 'DPO 1', qty: 6, unit_cost: 2, item_idxs: [0, 1] };
    expect(decoPoTotals(dp, items).liveQty).toBe(6); // 2+3+1, not C's 9
  });

  test('a per-item rate override beats the PO unit cost', () => {
    const dp = { po_id: 'DPO 1', qty: 0, unit_cost: 2, item_idxs: [0, 1], item_costs: { 1: 5 } };
    const { rows, liveExpected } = decoPoTotals(dp, items);
    expect(rows.map((r) => r.rate)).toEqual([2, 5]);
    expect(liveExpected).toBe(15); // (5 x 2) + (1 x 5)
  });

  test('a missing covered item is skipped rather than counted as zero-rate junk', () => {
    const dp = { po_id: 'DPO 1', qty: 0, unit_cost: 2, item_idxs: [0, 99] };
    expect(decoPoTotals(dp, items).rows).toHaveLength(1);
  });

  // safeNum treats a string as 0. A local Number() parse would disagree with the PO
  // page by exactly the cells somebody typed as text, and Sync would write a
  // different number than the page displays.
  test('matches the app helper on a size typed as text', () => {
    const dp = { po_id: 'DPO 1', qty: 0, unit_cost: 1, item_idxs: [0] };
    expect(decoPoTotals(dp, [{ sizes: { S: '4', M: 1 } }]).liveQty).toBe(1);
  });

  test('negative or zero cells never subtract', () => {
    const dp = { po_id: 'DPO 1', qty: 0, unit_cost: 1, item_idxs: [0] };
    expect(decoPoTotals(dp, [{ sizes: { S: 3, M: 0, L: -2 } }]).liveQty).toBe(3);
  });
});

describe('deco PO drift', () => {
  test('reports the pending change when the PO is behind the order', () => {
    // The live SO-2021 shape: PO saved at 42, covered items now total 43.
    const dp = { po_id: 'DPO 57243 SFXC', qty: 42, unit_cost: 3, item_idxs: [0, 1] };
    expect(decoPoDrift(dp, [{ sizes: { S: 42 } }, { sizes: { M: 1 } }]))
      .toEqual({ poId: 'DPO 57243 SFXC', from: 42, to: 43, expected: 129 });
  });

  test('nothing pending when it already agrees', () => {
    const dp = { po_id: 'DPO 1', qty: 6, unit_cost: 2, item_idxs: [0, 1] };
    expect(decoPoDrift(dp, items)).toBeNull();
  });

  test('nothing pending when the PO covers no items — that is Edit Items, not Sync', () => {
    expect(decoPoDrift({ po_id: 'DPO 1', qty: 5, unit_cost: 2, item_idxs: [] }, items)).toBeNull();
  });
});
