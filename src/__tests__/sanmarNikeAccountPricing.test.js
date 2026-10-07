/** @jest-environment node */
const { accountCostSnapshot } = require('../../netlify/functions/_sanmarAccountPricing');
test('Nike cost uses account prices and retains size premiums and color boundaries', () => {
  const rows = [
    { catalogColor: 'Black', size: 'S', myPrice: '35.87', piecePrice: '39.87' },
    { catalogColor: 'Black', size: '2XL', myPrice: '39.87', piecePrice: '43.87' },
    { catalogColor: 'Gorge Green', size: 'S', myPrice: '30' },
  ];
  expect(accountCostSnapshot(rows, 'Black')).toEqual({ nsa_cost: 35.87, size_costs: { '2XL': 39.87 } });
  expect(accountCostSnapshot(rows, 'White')).toBeNull();
});
test('missing/error pricing preserves existing costs instead of writing zero', () => {
  expect(accountCostSnapshot([], 'Black')).toBeNull();
  expect(accountCostSnapshot([{ color: 'Black', size: 'S', myPrice: 0, errorOccurred: true }], 'Black')).toBeNull();
});
test('uncolored account response supports sale price fallback and uniform sizes', () => {
  expect(accountCostSnapshot([{ size: 'S', myPrice: 0, salePrice: 12, piecePrice: 15 }, { size: 'M', myPrice: 12 }], 'Black')).toEqual({ nsa_cost: 12, size_costs: null });
});
jest.mock('../../netlify/functions/_sanmarInventory', () => ({ inventoryKey: (color, size) => `${color}|${size}`, stockByColorSize: () => ({ 'Black|S': 10 }) }));
const worker = require('../../netlify/functions/_background-workers/sanmar-nike-sync-background');
test.each([true, false])('scheduled Nike worker uses account pricing and preserves unavailable costs (%s)', async available => {
  const oldFetch = global.fetch;
  const oldEnv = { ...process.env };
  Object.assign(process.env, { URL: 'https://site.test', REACT_APP_SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', SANMAR_NIKE_STYLES: '' });
  const writes = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    let data = {};
    if (url.includes('/vendors?')) data = [{ id: 'v3' }];
    else if (url.includes('products?vendor_id')) data = [{ sku: 'NKFD9889-Black' }, { sku: 'OTHER-Black' }];
    else if (url.includes('action=getProductInfo')) data = { items: [{ colorName: 'Black', size: 'S', piecePrice: 39.87, msrp: 53.81 }] };
    else if (url.includes('action=getPricing')) data = { items: available ? [{ catalogColor: 'Black', size: 'S', myPrice: 35.87, piecePrice: 39.87 }] : [] };
    else if (url.includes('products?on_conflict')) writes.push(...JSON.parse(options.body));
    return { ok: true, json: async () => data };
  });
  try {
    const result = await worker.handler({ queryStringParameters: { style: 'NKFD9889' } });
    expect(result.statusCode).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].retail_price).toBe(53.81);
    if (available) expect(writes[0]).toMatchObject({ nsa_cost: 35.87, size_costs: null });
    else expect(writes[0]).not.toHaveProperty('nsa_cost');
    expect(global.fetch.mock.calls.some(([url]) => url.includes('action=getPricing'))).toBe(true);
  } finally { global.fetch = oldFetch; process.env = oldEnv; }
});
