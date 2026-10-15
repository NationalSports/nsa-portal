/* eslint-disable */
// SO-1829 (2026-10-12): an Adidas ADIZERO SL2 M line ordered 6.5 / 7.5 / 8 / 12, and
// PO 45000 FPUBBW covered three of them — but the PO line stored the raw Adidas half-size
// spelling ("6-", "7-") while the footwear line stores "6.5" / "7.5". Every PO reader looked
// the size up by exact string, so the line said "Need to order", the PO form offered 6.5 and
// 7.5 again as open (a double order waiting to happen), and the PO row drew its 1/1/1 under
// the first three columns (4 / 4.5 / 5.5) instead of the sizes it actually holds.
const { sizeQtyIn, sizeKeyIn, normalizeFootwearSize } = require('../lib/sizeNames.shared');
const { poCommitted, unfulfilledSizes, poOverCommit, planSizeCut, absorbedSizes } = require('../businessLogic');

// Stored shape of SO-1829 / KI6713 (so_items + so_item_po_lines rows) as hydrated.
const so1829Item = (over = {}) => Object.assign({
  sku: 'KI6713', is_footwear: true, nsa_cost: 53.62,
  sizes: { '7': 0, '8': 1, '9': 0, '10': 0, '12': 1, '6.5': 1, '7.5': 1, '8.5': 0, '9.5': 0 },
  pick_lines: [],
  po_lines: [
    { po_id: 'PO 45000 FPUBBW', vendor: 'Adidas', status: 'waiting', '12': 1, '6-': 1, '7-': 1, drop_ship: true, unit_cost: 53.62, received: {}, cancelled: {}, billed: {} },
  ],
}, over);

describe('sizeQtyIn / sizeKeyIn — one size, any spelling', () => {
  test('a half size reads every spelling of itself', () => {
    expect(sizeQtyIn({ '6-': 1 }, '6.5')).toBe(1);
    expect(sizeQtyIn({ '6½': 2 }, '6.5')).toBe(2);
    expect(sizeQtyIn({ '6.5': 3 }, '6-')).toBe(3);
    expect(sizeQtyIn({ '6-': 1, '6.5': 2 }, '6.5')).toBe(3);
  });

  test('neighbouring and non-half sizes never bleed into each other', () => {
    const pl = { '6': 4, '6-': 1, '16': 9, unit_cost: 53.62, M: 2 };
    expect(sizeQtyIn(pl, '6')).toBe(4);
    expect(sizeQtyIn(pl, '6.5')).toBe(1);
    expect(sizeQtyIn(pl, 'M')).toBe(2);
    expect(sizeQtyIn(pl, 'L')).toBe(0);
    expect(sizeQtyIn(null, '6.5')).toBe(0);
  });

  test('sizeKeyIn returns the spelling the map already uses', () => {
    expect(sizeKeyIn({ '6-': 1 }, '6.5')).toBe('6-');
    expect(sizeKeyIn({ '6.5': 1 }, '6.5')).toBe('6.5');
    expect(sizeKeyIn({ '7-': 1 }, '6.5')).toBe('6.5');
    expect(sizeKeyIn({ M: 1 }, 'M')).toBe('M');
    expect(sizeKeyIn(undefined, '6.5')).toBe('6.5');
  });

  test('the normalizer is the same one constants.js exports', () => {
    expect(normalizeFootwearSize('10-')).toBe('10.5');
    expect(require('../constants').normalizeFootwearSize).toBe(normalizeFootwearSize);
  });
});

describe('SO-1829 — a "6-" PO line counts against the "6.5" order line', () => {
  test('poCommitted sees the units on PO 45000', () => {
    const it = so1829Item();
    expect(poCommitted(it.po_lines, '6.5')).toBe(1);
    expect(poCommitted(it.po_lines, '7.5')).toBe(1);
    expect(poCommitted(it.po_lines, '12')).toBe(1);
    expect(poCommitted(it.po_lines, '8')).toBe(0);
  });

  test('only size 8 is still open to order (the form used to offer 6.5 and 7.5 again)', () => {
    expect(unfulfilledSizes(so1829Item()).open).toEqual({ '8': 1 });
  });

  test('ordering 6.5 again is flagged as an over-commit naming the PO that holds it', () => {
    const over = poOverCommit(so1829Item(), { '6.5': 1 });
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ sz: '6.5', open: 0, committed: 1, pos: ['PO 45000 FPUBBW'] });
    expect(poOverCommit(so1829Item(), { '8': 1 })).toEqual([]);
  });

  test('cancelled units are matched by size too', () => {
    const it = so1829Item();
    it.po_lines[0]['6-'] = 3;
    it.po_lines[0].cancelled = { '6-': 1 };
    expect(poCommitted(it.po_lines, '6.5')).toBe(2);
  });
});

describe('planSizeCut on a legacy-spelled footwear PO line', () => {
  test('lowering 6.5 trims the open "6-" unit — a plain cut, not a write-off', () => {
    const it = so1829Item();
    const p = planSizeCut(it, '6.5', 0);
    expect(p.kind).toBe('cut');
    expect(p.cut).toBe(1);
    expect(p.absorb).toBe(0);
    const pl = p.po_lines[0];
    expect(pl['6-']).toBeUndefined();
    expect(pl['6.5']).toBeUndefined();
    expect(pl['7-']).toBe(1);
    expect(pl['12']).toBe(1);
    expect(it.po_lines[0]['6-']).toBe(1); // never mutates the input
  });

  test('a partial cut writes back to the bucket the line already uses', () => {
    const it = so1829Item({ sizes: { '6.5': 3 }, po_lines: [{ po_id: 'PO 1', status: 'waiting', '6-': 3, received: {} }] });
    const p = planSizeCut(it, '6.5', 1);
    expect(p.kind).toBe('cut');
    expect(p.po_lines[0]['6-']).toBe(1);
    expect(p.po_lines[0]['6.5']).toBeUndefined();
  });

  test('billed "6-" units are absorbed, not silently ignored', () => {
    const it = so1829Item({ po_lines: [{ po_id: 'PO 3540', status: 'waiting', '6-': 1, drop_ship: true, received: {}, billed: { '6-': 1 } }] });
    const p = planSizeCut(it, '6.5', 0);
    expect(p.kind).toBe('absorb');
    expect(p.absorb).toBe(1);
    expect(p.po_lines[0]['6-']).toBe(1);
  });
});

describe('absorbedSizes — a re-spelled line is not a write-off', () => {
  test('billed "6-" against a "6.5" line reports nothing written off', () => {
    const it = so1829Item({ po_lines: [{ po_id: 'PO 3540', '6-': 1, '7-': 1, received: {}, billed: { '6-': 1, '7-': 1 } }] });
    expect(absorbedSizes(it)).toEqual({});
  });

  test('a genuine over-ship of a half size still shows, in the line spelling', () => {
    const it = so1829Item({ po_lines: [{ po_id: 'PO 3540', '6-': 2, received: { '6-': 2 }, billed: {} }] });
    expect(absorbedSizes(it)).toEqual({ '6.5': 1 });
  });
});
