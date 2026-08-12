/* eslint-disable */
// businessLogic.splitBillToStock — routes the excess units of an over-billed vendor document
// into stock instead of charging the whole invoice to the one order it was matched to.
// THE INVARIANT UNDER TEST: order units + stock units always equal the billed units, and the
// stock cost never exceeds the bill. This must never make money (or goods) disappear.
const { splitBillToStock, billOverageQty } = require('../businessLogic');

const totalUnits = (m) => Object.values(m).reduce((a, v) => a + v, 0);

describe('splitBillToStock', () => {
  describe('ordinary bills are inert', () => {
    test('billed exactly the ordered qty → nothing to stock', () => {
      const r = splitBillToStock([{ size: 'M', billed: 12, ordered: 12, received: 12, need: 12, unit: 5 }]);
      expect(r.splitAny).toBe(false);
      expect(r.stock).toEqual({});
      expect(r.order).toEqual({ M: 12 });
      expect(r.stockCost).toBe(0);
    });

    test('billed UNDER the ordered qty → stays whole on the order, never clamped up or down', () => {
      const r = splitBillToStock([{ size: 'M', billed: 5, ordered: 12, received: 0, need: 12, unit: 5 }]);
      expect(r.splitAny).toBe(false);
      expect(r.order).toEqual({ M: 5 });
    });

    test('empty / malformed input is safe', () => {
      expect(splitBillToStock([]).splitAny).toBe(false);
      expect(splitBillToStock(null).splitAny).toBe(false);
      expect(splitBillToStock([null, { size: null, billed: 5 }, { size: 'M', billed: 0 }]).splitAny).toBe(false);
    });
  });

  describe('SO-1271 — the real case', () => {
    // Richardson 4665290: 306 SM-MD billed (25.5 dz @ $67.60/dz = $5.6333/pc) against 48
    // ordered, nothing received (drop ship). 4678804: 18 LG-XL billed against 12 ordered.
    const unit = 67.60 / 12;
    const entries = [
      { size: 'SM-MD', billed: 306, ordered: 48, received: 0, need: 48, unit },
      { size: 'LG-XL', billed: 18, ordered: 12, received: 0, need: 12, unit },
    ];

    test('excess goes to stock, order keeps what it justifies', () => {
      const r = splitBillToStock(entries);
      expect(r.order).toEqual({ 'SM-MD': 48, 'LG-XL': 12 });
      expect(r.stock).toEqual({ 'SM-MD': 258, 'LG-XL': 6 });
      expect(r.stockUnits).toBe(264);
      expect(r.stockCost).toBeCloseTo(264 * unit, 2); // $1,487.20
    });

    test('units balance: order + stock === billed', () => {
      const r = splitBillToStock(entries);
      expect(totalUnits(r.order) + totalUnits(r.stock)).toBe(306 + 18);
    });

    test('money balances: order cost + stock cost === the full bill', () => {
      const r = splitBillToStock(entries);
      const billTotal = 1723.80 + 101.40;
      const orderCost = totalUnits(r.order) * unit;
      expect(orderCost + r.stockCost).toBeCloseTo(billTotal, 1);
    });

    test('the order is left costing 60 hats, not 324', () => {
      const r = splitBillToStock(entries);
      expect(totalUnits(r.order)).toBe(60);
      expect(totalUnits(r.order) * unit).toBeCloseTo(338.00, 2);
    });
  });

  describe('justification ceiling matches billOverageQty', () => {
    test('over-RECEIVED goods are justified — they physically arrived, so nothing to stock', () => {
      const r = splitBillToStock([{ size: 'S', billed: 30, ordered: 10, received: 30, need: 10, unit: 5 }]);
      expect(r.splitAny).toBe(false);
      expect(r.order).toEqual({ S: 30 });
    });

    test('partial receipt: received sets the ceiling, the rest goes to stock', () => {
      const r = splitBillToStock([{ size: 'S', billed: 30, ordered: 10, received: 20, need: 10, unit: 5 }]);
      expect(r.order).toEqual({ S: 20 });
      expect(r.stock).toEqual({ S: 10 });
      expect(r.stockCost).toBeCloseTo(50, 2);
    });

    test('the order legitimately grew (need > ordered) — need sets the ceiling', () => {
      const r = splitBillToStock([{ size: 'S', billed: 30, ordered: 10, received: 0, need: 25, unit: 5 }]);
      expect(r.order).toEqual({ S: 25 });
      expect(r.stock).toEqual({ S: 5 });
    });

    test('agrees with billOverageQty on every branch', () => {
      const cases = [
        [10, 30, 0, 10], [10, 30, 20, 10], [10, 30, 0, 25], [10, 5, 0, 10], [10, 10, 10, 10], [0, 12, 0, 0],
      ];
      cases.forEach(([ordered, billed, received, need]) => {
        const cap = billOverageQty(ordered, billed, received, need);
        const expectedExcess = billed > ordered ? Math.max(0, billed - cap) : 0;
        const r = splitBillToStock([{ size: 'X', billed, ordered, received, need, unit: 1 }]);
        expect(r.stock.X || 0).toBe(expectedExcess);
        expect((r.order.X || 0) + (r.stock.X || 0)).toBe(billed);
      });
    });
  });

  describe('safety properties', () => {
    test('never produces negative quantities', () => {
      const r = splitBillToStock([{ size: 'S', billed: 5, ordered: 100, received: 0, need: 100, unit: 5 }]);
      Object.values(r.order).forEach(v => expect(v).toBeGreaterThanOrEqual(0));
      Object.values(r.stock).forEach(v => expect(v).toBeGreaterThanOrEqual(0));
    });

    test('missing unit price → units still split, cost is 0 (never NaN)', () => {
      const r = splitBillToStock([{ size: 'S', billed: 30, ordered: 10, received: 0, need: 10 }]);
      expect(r.stock).toEqual({ S: 20 });
      expect(r.stockCost).toBe(0);
      expect(Number.isNaN(r.stockCost)).toBe(false);
    });

    test('duplicate size entries accumulate rather than overwrite', () => {
      const r = splitBillToStock([
        { size: 'S', billed: 30, ordered: 10, received: 0, need: 10, unit: 2 },
        { size: 'S', billed: 30, ordered: 10, received: 0, need: 10, unit: 2 },
      ]);
      expect(r.order).toEqual({ S: 20 });
      expect(r.stock).toEqual({ S: 40 });
      expect(r.stockCost).toBeCloseTo(80, 2);
    });

    test('units balance holds across a randomized sweep', () => {
      for (let i = 0; i < 300; i++) {
        const ordered = i % 17, received = (i * 3) % 23, need = (i * 5) % 19, billed = (i * 7) % 41;
        const r = splitBillToStock([{ size: 'Z', billed, ordered, received, need, unit: 1.5 }]);
        expect((r.order.Z || 0) + (r.stock.Z || 0)).toBe(billed > 0 ? billed : 0);
        expect(r.stockCost).toBeCloseTo((r.stock.Z || 0) * 1.5, 2);
      }
    });

    test('stock cost never exceeds the whole bill', () => {
      const unit = 5.6333333;
      const r = splitBillToStock([{ size: 'S', billed: 306, ordered: 48, received: 0, need: 48, unit }]);
      expect(r.stockCost).toBeLessThan(306 * unit);
      expect(r.stockCost).toBeCloseTo(258 * unit, 2);
    });
  });
});
