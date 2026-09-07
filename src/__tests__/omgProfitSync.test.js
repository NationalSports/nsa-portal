const { aggregateStoreOrders, commissionCloseout, monthStart, previousMonthStart } = require('../../netlify/functions/_omgProfit');

const order = (id, createdAt, feeFields = {}) => ({ id, attributes: { created_at: createdAt, status: 'complete', ...feeFields } });
const response = (lines, products) => ({
  data: lines.map((attributes, i) => ({ id: `line-${i}`, attributes, relationships: { product: { data: { id: `p-${i}`, type: 'product' } } } })),
  included: products.map((attributes, i) => ({ id: `p-${i}`, type: 'product', attributes })),
});

describe('OMG nightly profit aggregation', () => {
  test('aggregates calendar months with option-aware line totals, COGS, fees, and refunds', () => {
    const result = aggregateStoreOrders([
      {
        order: order('o1', '2026-08-15T18:00:00Z', { omg_fee: 2, processing_fee: 3, invoiced_fee: 0, refund_amount: 5 }),
        response: response([{ quantity: 2, line_total: 90 }], [{ base_price: 40, cogs: 25 }]),
      },
      {
        order: order('o2', '2026-09-01T18:00:00Z', { omg_fee: 1, processing_fee: 1, invoiced_fee: 0, refund_amount: 0 }),
        response: response([{ quantity: 1, unit_price: 55 }], [{ base_price: 50, cogs: 30 }]),
      },
    ]);
    expect(result.validation.ready).toBe(true);
    expect(result.months).toHaveLength(2);
    expect(result.months[0]).toMatchObject({ periodMonth: '2026-08-01', products: 2, productCollected: 90, itemCost: 50, productProfit: 40, netProfit: 30 });
    expect(result.cumulative).toMatchObject({ products: 3, productCollected: 145, itemCost: 80, productProfit: 65, netProfit: 53 });
  });

  test('holds a closeout when OMG omits fee accounting fields', () => {
    const result = aggregateStoreOrders([{ order: order('o1', '2026-08-15T18:00:00Z'), response: response([{ quantity: 1, line_total: 50 }], [{ cogs: 20 }]) }]);
    expect(result.validation).toMatchObject({ pricingComplete: true, cogsComplete: true, feesComplete: false, ready: false });
  });

  test('does not silently treat catalog base price as option-aware collected revenue', () => {
    const result = aggregateStoreOrders([{
      order: order('o1', '2026-08-15T18:00:00Z', { omg_fee: 0, processing_fee: 0, invoiced_fee: 0 }),
      response: response([{ quantity: 1 }], [{ base_price: 50, cogs: 20 }]),
    }]);
    expect(result.months[0].productCollected).toBe(50);
    expect(result.validation).toMatchObject({ pricingComplete: false, ready: false });
  });

  test('uses existing commission policy for GP and revenue reps', () => {
    const totals = { productCollected: 1000, refunds: 50, netProfit: 300 };
    expect(commissionCloseout(totals, {})).toEqual({ basis: 'gp', rate: 0.3, base: 300, amount: 90 });
    expect(commissionCloseout(totals, { commission_basis: 'revenue', commission_rate: 0.01 })).toEqual({ basis: 'revenue', rate: 0.01, base: 950, amount: 9.5 });
  });

  test('keys month-end records predictably', () => {
    expect(monthStart('2026-09-01T02:00:00Z')).toBe('2026-08-01');
    expect(previousMonthStart(new Date('2026-09-02T10:30:00Z'))).toBe('2026-08-01');
  });
});
