const {
  normalizeOmgProfitRow,
  normalizePeriodMonth,
  parseNumber,
  latestMonthlyProfit,
  buildManualCommissionCloseout,
} = require('../lib/omgMonthlyProfit');

describe('OMG monthly profit import', () => {
  test('parses the exact OMG Margin Report summary columns', () => {
    const row = normalizeOmgProfitRow({
      'Store Code': '5yp6d',
      'Store Name': 'WVC Team Store 2026',
      Products: '42',
      Collected: '$2,084.50',
      Cost: '$1,447.05',
      Profit: '$637.45',
      Margin: '30.58%',
    }, { periodMonth: '2026-08-01', isCumulative: true });

    expect(row).toMatchObject({
      storeCode: '5YP6D',
      products: 42,
      productCollected: 2084.5,
      itemCost: 1447.05,
      productProfit: 637.45,
      marginPct: 30.58,
      netProfit: 637.45,
      periodMonth: '2026-08-01',
      isCumulative: true,
    });
  });

  test('calculates profit and profit after optional OMG fees', () => {
    const row = normalizeOmgProfitRow({
      'Sale Code': 'ABC12', Collected: '1,000', COGS: '(600)',
      'OMG Fees': '$25', 'Processing Fee': '$30', Refunds: '$20',
    }, { periodMonth: '2026-09' });
    expect(row.itemCost).toBe(600);
    expect(row.productProfit).toBe(400);
    expect(row.netProfit).toBe(325);
  });

  test('calculates month-over-month change for cumulative snapshots', () => {
    const result = latestMonthlyProfit([
      { period_month: '2026-07-01', is_cumulative: true, product_collected: 1000, item_cost: 600, product_profit: 400, net_profit: 350 },
      { period_month: '2026-08-01', is_cumulative: true, product_collected: 1450, item_cost: 850, product_profit: 600, net_profit: 520 },
    ]);
    expect(result).toMatchObject({ collected: 450, itemCost: 250, productProfit: 200, netProfit: 170, baseline: false });
  });

  test('marks the first cumulative snapshot as a baseline', () => {
    const result = latestMonthlyProfit([
      { period_month: '2026-08-01', is_cumulative: true, product_profit: 637.45, net_profit: 600 },
    ]);
    expect(result.baseline).toBe(true);
    expect(result.productProfit).toBeNull();
    expect(result.netProfit).toBeNull();
  });

  test('uses monthly totals directly and normalizes common month formats', () => {
    const result = latestMonthlyProfit([
      { period_month: '2026-08-01', is_cumulative: false, product_collected: 500, item_cost: 300, product_profit: 200, net_profit: 170 },
    ]);
    expect(result).toMatchObject({ collected: 500, itemCost: 300, productProfit: 200, netProfit: 170, baseline: false });
    expect(normalizePeriodMonth('8/2026')).toBe('2026-08-01');
    expect(parseNumber('($1,234.50)')).toBe(-1234.5);
  });

  test('turns the second cumulative snapshot into a finalized GP commission month', () => {
    const result = buildManualCommissionCloseout({
      snapshot: { id: 'snap-2', store_code: '5YP6D', period_month: '2026-10-01', is_cumulative: true, product_collected: 3084.5, item_cost: 2047.05, product_profit: 1037.45, refunds: 10, omg_fees: 127.74, processing_fees: 100.21, invoiced_fees: 5, net_profit: 794.5 },
      previousSnapshot: { id: 'snap-1', period_month: '2026-09-01', is_cumulative: true, product_collected: 2084.5, item_cost: 1447.05, product_profit: 637.45, refunds: 0, omg_fees: 97.74, processing_fees: 80.21, invoiced_fees: 0, net_profit: 459.5 },
      store: { id: 'OMG-sale_5YP6D', _omg_sale_code: '5YP6D', customer_id: 'c1' },
      customer: { id: 'c1' },
      rep: { id: 'rep-1' },
      now: '2026-11-01T12:00:00.000Z',
    });
    expect(result.kind).toBe('finalized');
    expect(result.row).toMatchObject({
      period_month: '2026-10-01', product_collected: 1000, item_cost: 600,
      product_profit: 400, fees_and_refunds: 65, net_profit: 335,
      commission_basis: 'gp', commission_rate: 0.30, commission_amount: 100.5,
      status: 'finalized', source_snapshot_id: 'snap-2',
    });
  });

  test('keeps the first cumulative snapshot as a baseline with no commission row', () => {
    const result = buildManualCommissionCloseout({
      snapshot: { id: 'snap-1', period_month: '2026-09-01', is_cumulative: true },
      store: { id: 'store-1', _omg_sale_code: 'ABC12', customer_id: 'c1' },
      customer: { id: 'c1' }, rep: { id: 'rep-1' },
    });
    expect(result).toMatchObject({ kind: 'baseline', row: null });
  });

  test('uses the rep revenue policy and holds stores linked to a portal sales order', () => {
    const result = buildManualCommissionCloseout({
      snapshot: { id: 'snap-1', period_month: '2026-09-01', is_cumulative: false, product_collected: 1000, item_cost: 600, product_profit: 400, refunds: 50, omg_fees: 25, processing_fees: 30, invoiced_fees: 0, net_profit: 295 },
      store: { id: 'store-1', _omg_sale_code: 'ABC12', customer_id: 'c1' },
      customer: { id: 'c1' },
      rep: { id: 'rep-1', commission_basis: 'revenue', commission_rate: 0.01 },
      linkedSoIds: ['SO-1'],
      now: '2026-10-01T12:00:00.000Z',
    });
    expect(result.kind).toBe('held');
    expect(result.row).toMatchObject({ commission_basis: 'revenue', commission_rate: 0.01, commission_amount: 0, status: 'held' });
    expect(result.row.hold_reason).toMatch(/duplicate commission/);
  });
});
