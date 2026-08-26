/* Item-linked webstore refund allocation. */

const { buildRefundItemAllocations } = require('../../netlify/functions/stripe-payment');

const item = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Training Pant', sku: 'HI0704', unit_price: 30, unit_fundraise: 0,
  cancelled_qty: 2, refunded_qty: 0,
  ...over,
});

describe('buildRefundItemAllocations', () => {
  test('splits exact refund cents across selected cancelled items', () => {
    const rows = [
      item(),
      item({ id: '22222222-2222-4222-8222-222222222222', name: 'Tee', sku: 'JL5410', unit_price: 20, cancelled_qty: 1 }),
    ];
    const got = buildRefundItemAllocations(8118, [
      { item_id: rows[0].id, qty: 1 },
      { item_id: rows[1].id, qty: 1 },
    ], rows);
    expect(got.reduce((n, a) => n + Math.round(a.amount * 100), 0)).toBe(8118);
    expect(got).toEqual([
      { item_id: rows[0].id, qty: 1, amount: 48.7 },
      { item_id: rows[1].id, qty: 1, amount: 32.48 },
    ]);
  });

  test('combines duplicate selections before validating available quantity', () => {
    const row = item();
    const got = buildRefundItemAllocations(6000, [
      { item_id: row.id, qty: 1 },
      { item_id: row.id, qty: 1 },
    ], [row]);
    expect(got).toEqual([{ item_id: row.id, qty: 2, amount: 60 }]);
  });

  test('rejects a quantity already refunded or not cancelled', () => {
    const row = item({ cancelled_qty: 2, refunded_qty: 1 });
    expect(() => buildRefundItemAllocations(6000, [{ item_id: row.id, qty: 2 }], [row]))
      .toThrow('only has 1 cancelled unit awaiting refund');
  });

  test('empty selection remains a deliberate order-level refund', () => {
    expect(buildRefundItemAllocations(2500, [], [item()])).toEqual([]);
  });
});
