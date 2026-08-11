/* eslint-disable */
// businessLogic.garmentCost — the single PO-aware garment cost walk shared by
// OrderEditor `totals`, Reports soCalc (App.js), and calcGP (CommissionsPage.js).
// Core rule under test (SO-1271): a PO line with a supplier bill (_bill_cost) costs
// at the bill for its billed units — not at ordered qty × unit_cost/catalog — while
// un-billed lines and uncovered quantities keep the old expected behavior.
const { garmentCost } = require('../businessLogic');

describe('garmentCost', () => {
  test('no POs → sold qty × catalog nsa_cost (unchanged behavior)', () => {
    const it = { sizes: { S: 10, M: 5 }, nsa_cost: 4, po_lines: [] };
    expect(garmentCost(it)).toEqual({ cost: 60, poQty: 0, q: 15 });
  });

  test('no POs, _sizeCosts per-size upcharges (unchanged behavior)', () => {
    const it = { sizes: { M: 2, '2XL': 3 }, nsa_cost: 10, _sizeCosts: { '2XL': 12 }, po_lines: [] };
    expect(garmentCost(it).cost).toBe(2 * 10 + 3 * 12);
  });

  test('un-billed PO line → ordered qty × unit_cost, even when over-ordered (unchanged behavior)', () => {
    const it = {
      sizes: { S: 10 }, nsa_cost: 8,
      po_lines: [{ S: 30, unit_cost: 6, status: 'waiting', po_id: 'PO 1' }],
    };
    expect(garmentCost(it)).toEqual({ cost: 180, poQty: 30, q: 10 });
  });

  test('un-billed PO line without unit_cost falls back to catalog (unchanged behavior)', () => {
    const it = { sizes: { S: 10 }, nsa_cost: 8, po_lines: [{ S: 10, po_id: 'PO 1' }] };
    expect(garmentCost(it).cost).toBe(80);
  });

  test('PO covers only part of sold qty → shortfall at catalog (unchanged behavior)', () => {
    const it = { sizes: { S: 10 }, nsa_cost: 8, po_lines: [{ S: 4, unit_cost: 6 }] };
    expect(garmentCost(it).cost).toBe(4 * 6 + 6 * 8);
  });

  test('billed line: _bill_cost replaces ordered×cost for billed units; open remainder at expected', () => {
    // SO-1271 hat shape: 66 sold, PO ordered 330, billed 324 for $1825.20 real
    // ($5.63/u vs $8.71 catalog, no unit_cost on the line). Old walk: 330×8.71=2874.30.
    const it = {
      sizes: { 'LG-XL': 12, 'SM-MD': 48, 'XS-SM': 6 }, nsa_cost: 8.71,
      po_lines: [{
        'LG-XL': 18, 'SM-MD': 306, 'XS-SM': 6, drop_ship: true,
        _bill_cost: 1825.2, billed: { 'LG-XL': 18, 'SM-MD': 306 },
        po_id: 'PO 3313 SOCB', status: 'waiting',
      }],
    };
    const r = garmentCost(it);
    // bill 1825.20 + 6 still-open units at catalog 8.71
    expect(r.cost).toBeCloseTo(1825.2 + 6 * 8.71, 2);
    expect(r.poQty).toBe(330);
  });

  test('fully billed line at ordered qty → exactly the bill', () => {
    const it = {
      sizes: { L: 18, M: 8, XL: 12 }, nsa_cost: 5.14,
      po_lines: [{ L: 64, M: 25, XL: 37, unit_cost: 5.14, _bill_cost: 647.64, billed: { L: 64, M: 25, XL: 37 } }],
    };
    expect(garmentCost(it).cost).toBeCloseTo(647.64, 2);
  });

  test('bill present but no billed size breakdown → bill covers the whole line (no double count)', () => {
    const it = {
      sizes: { S: 10 }, nsa_cost: 8,
      po_lines: [{ S: 10, unit_cost: 6, _bill_cost: 55, billed: {} }],
    };
    expect(garmentCost(it).cost).toBe(55);
  });

  test('billed qty above ordered qty never goes negative', () => {
    const it = {
      sizes: { S: 5 }, nsa_cost: 8,
      po_lines: [{ S: 5, unit_cost: 6, _bill_cost: 40, billed: { S: 9 } }],
    };
    expect(garmentCost(it).cost).toBe(40);
  });

  test('mixed lines: billed line at bill, un-billed sibling at expected', () => {
    const it = {
      sizes: { S: 10 }, nsa_cost: 8.71,
      po_lines: [
        { S: 6, _bill_cost: 33.78, billed: { S: 6 } },       // real 5.63/u
        { S: 4, po_id: 'PO 2' },                              // open → 4 × 8.71 catalog
      ],
    };
    expect(garmentCost(it).cost).toBeCloseTo(33.78 + 4 * 8.71, 2);
  });

  test('meta keys on the PO line are never counted as size qty', () => {
    const it = {
      sizes: { S: 2 }, nsa_cost: 10,
      po_lines: [{ S: 2, unit_cost: 5, shipping: 12, _bill_details: [{ cost: 1 }], drop_ship: true, batch_queue_id: 9 }],
    };
    expect(garmentCost(it)).toEqual({ cost: 10, poQty: 2, q: 2 });
  });

  test('zero-qty item → zero cost', () => {
    expect(garmentCost({ sizes: {}, nsa_cost: 9 })).toEqual({ cost: 0, poQty: 0, q: 0 });
  });

  test('est_qty fallback when sizes not broken out (unchanged behavior)', () => {
    const it = { sizes: {}, est_qty: 12, nsa_cost: 3, po_lines: [] };
    expect(garmentCost(it)).toEqual({ cost: 36, poQty: 0, q: 12 });
  });
});
