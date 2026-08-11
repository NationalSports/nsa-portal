/* eslint-disable */
// businessLogic.billOverage — flags a supplier bill that covers more units than the order
// can justify. garmentCost() charges the whole bill to the order (correctly — it is real
// money owed), so without this nothing on the page explains why an order reads underwater.
// Detection only: it must never change a cost, and must stay silent on ordinary lines.
const { billOverage, garmentCost } = require('../businessLogic');

describe('billOverage', () => {
  test('bill within the order qty → null (no flag on a normal line)', () => {
    const it = { sizes: { L: 18, M: 8, XL: 12 }, nsa_cost: 5.14,
      po_lines: [{ L: 18, M: 8, XL: 12, unit_cost: 5.14, _bill_cost: 195.32, billed: { L: 18, M: 8, XL: 12 } }] };
    expect(billOverage(it)).toBeNull();
  });

  test('no bill entered → null (un-billed PO is not an overage)', () => {
    const it = { sizes: { OSFA: 15 }, nsa_cost: 3.39, po_lines: [{ OSFA: 15, unit_cost: 3.39, billed: {} }] };
    expect(billOverage(it)).toBeNull();
  });

  test('no PO lines at all → null', () => {
    expect(billOverage({ sizes: { S: 10 }, nsa_cost: 4, po_lines: [] })).toBeNull();
  });

  test('SO-1271 hats: 324 billed against 66 sold, nothing received (drop ship)', () => {
    const it = {
      sizes: { 'LG-XL': 12, 'SM-MD': 48, 'XS-SM': 6 }, nsa_cost: 8.71,
      po_lines: [{
        'LG-XL': 18, 'SM-MD': 306, 'XS-SM': 6, drop_ship: true,
        _bill_cost: 1825.2, billed: { 'LG-XL': 18, 'SM-MD': 306 }, received: {},
        po_id: 'PO 3313 SOCB', status: 'waiting',
      }],
    };
    const r = billOverage(it);
    expect(r.billedQty).toBe(324);
    expect(r.justifiedQty).toBe(66);
    expect(r.overUnits).toBe(258);
    expect(r.billCost).toBeCloseTo(1825.2, 2);
    // 258/324 of the bill is unjustified by this order
    expect(r.overCost).toBeCloseTo(1825.2 * 258 / 324, 2);
  });

  test('over-receiving justifies the bill (received beats sold qty)', () => {
    // Vendor shipped 30 against a 10-piece line and we checked all 30 in — the goods are
    // genuinely here, so the bill is justified and must not be flagged.
    const it = { sizes: { S: 10 }, nsa_cost: 5,
      po_lines: [{ S: 30, unit_cost: 5, _bill_cost: 150, billed: { S: 30 }, received: { S: 30 } }] };
    expect(billOverage(it)).toBeNull();
  });

  test('partial receipt: justification is the larger of sold qty and received', () => {
    const it = { sizes: { S: 10 }, nsa_cost: 5,
      po_lines: [{ S: 30, unit_cost: 5, _bill_cost: 150, billed: { S: 30 }, received: { S: 20 } }] };
    const r = billOverage(it);
    expect(r.justifiedQty).toBe(20);
    expect(r.overUnits).toBe(10);
    expect(r.overCost).toBeCloseTo(50, 2);
  });

  test('bill with no size breakdown is measured against the whole line', () => {
    const it = { sizes: { S: 5 }, nsa_cost: 5, po_lines: [{ S: 40, unit_cost: 5, _bill_cost: 200, billed: {} }] };
    const r = billOverage(it);
    expect(r.billedQty).toBe(40);
    expect(r.overUnits).toBe(35);
  });

  test('outside-deco PO lines are ignored (blanks only)', () => {
    const it = { sizes: { S: 5 }, nsa_cost: 5,
      po_lines: [{ S: 100, po_type: 'outside_deco', _bill_cost: 500, billed: { S: 100 } }] };
    expect(billOverage(it)).toBeNull();
  });

  test('multiple billed lines aggregate', () => {
    const it = { sizes: { S: 10 }, nsa_cost: 5, po_lines: [
      { S: 10, _bill_cost: 50, billed: { S: 10 } },
      { S: 40, _bill_cost: 200, billed: { S: 40 } },
    ] };
    const r = billOverage(it);
    expect(r.billedQty).toBe(50);
    expect(r.overUnits).toBe(40);
    expect(r.billCost).toBeCloseTo(250, 2);
  });

  test('est_qty fallback when sizes are not broken out', () => {
    const it = { sizes: {}, est_qty: 12, nsa_cost: 5, po_lines: [{ QTY: 60, _bill_cost: 300, billed: { QTY: 60 } }] };
    const r = billOverage(it);
    expect(r.justifiedQty).toBe(12);
    expect(r.overUnits).toBe(48);
  });

  test('detection does not change cost — garmentCost still charges the full bill', () => {
    // The flag is advisory: code cannot tell a mis-mapped invoice from a real stock buy,
    // so the money owed stays on the order until a human re-allocates the document.
    const it = {
      sizes: { 'LG-XL': 12, 'SM-MD': 48, 'XS-SM': 6 }, nsa_cost: 8.71,
      po_lines: [{ 'LG-XL': 18, 'SM-MD': 306, 'XS-SM': 6, _bill_cost: 1825.2,
        billed: { 'LG-XL': 18, 'SM-MD': 306 }, drop_ship: true }],
    };
    expect(billOverage(it)).not.toBeNull();
    expect(garmentCost(it).cost).toBeCloseTo(1825.2 + 6 * 8.71, 2);
  });
});
