/** @jest-environment node */
const { shippingConfig, validateShipping, needsShippingQuote } = require('../lib/webstoreShippingRules.shared');
const { quoteShipping } = require('../../netlify/functions/_webstoreShipping');
const checkout = require('../../netlify/functions/webstore-checkout');
const store = { id: 's', slug: 'test', org_type: 'team', status: 'open', payment_mode: 'unpaid', delivery_mode: 'ship_home', flat_shipping: 12 };
const lines = [{ kind: 'single', qty: 2 }, { kind: 'bundle', qty: 1, components: [{ qty: 3 }, { qty: 1 }] }];
const tiers = [{ from: 0, amount_cents: 1200 }, { from: 5000, amount_cents: 800 }, { from: 10000, amount_cents: 0 }];
const price = (shipping_settings, subtotal, coupon = false) => quoteShipping(null, { ...store, shipping_settings }, lines, null, coupon, subtotal);
test.each([[49.99, 12], [50, 8], [99.99, 8], [100, 0], [999, 0]])('order total %s has rate %s', async (subtotal, amount) => {
  expect(await price({ mode: 'order_total', tiers }, subtotal)).toMatchObject({ amount });
});
test('item tiers count bundle garments without the parent', async () => {
  expect(await price({ mode: 'item_count', tiers: [{ from: 0, amount_cents: 600 }, { from: 6, amount_cents: 1500 }] }, 20)).toMatchObject({ amount: 15, quote: { item_count: 6 } });
});
test('free threshold is inclusive and a free-shipping coupon overrides tiers', async () => {
  const config = { mode: 'flat', free_over_cents: 10000 };
  expect((await price(config, 99.99)).amount).toBe(12);
  expect((await price(config, 100)).amount).toBe(0);
  expect((await price({ mode: 'order_total', tiers }, 50, true)).amount).toBe(0);
  expect((await price({ mode: 'free' }, 1)).amount).toBe(0);
});
test.each([
  { mode: 'unknown' }, { mode: 'flat', free_over_cents: 0 }, { mode: 'flat', free_over_cents: -1 },
  { mode: 'order_total', tiers: [] }, { mode: 'order_total', tiers: [null] },
  { mode: 'order_total', tiers: [{ from: 5, amount_cents: 12 }] },
  { mode: 'order_total', tiers: [{ from: 0, amount_cents: 12 }, { from: 0, amount_cents: 8 }] },
  { mode: 'item_count', tiers: [{ from: 0, amount_cents: -5 }] },
  { mode: 'item_count', tiers: [{ from: 0, amount_cents: 5 }, { from: 1.5, amount_cents: 8 }] },
])('invalid rules fail closed: %j', async config => {
  expect(validateShipping(config)).toBeTruthy();
  expect((await price(config, 100)).code).toBe('shipping_unavailable');
});
test('new settings take precedence, and legacy settings remain valid', () => {
  const legacy = { ...store, all_school_settings: { shipping: { mode: 'ups_live' } } };
  expect(shippingConfig(legacy).mode).toBe('ups_live');
  expect(shippingConfig({ ...legacy, shipping_settings: { mode: 'free' } }).mode).toBe('free');
  expect(needsShippingQuote(store)).toBeFalsy();
  expect(needsShippingQuote(legacy)).toBeTruthy();
  expect(needsShippingQuote({ ...store, shipping_settings: { mode: 'flat', free_over_cents: 10000 } })).toBeTruthy();
});
test('public configuration excludes operational carrier fields', () => {
  expect(checkout.publicStoreRow({ ...store, shipping_settings: { mode: 'ups_live', free_over_cents: 10000, package_weight_oz: 9 } }).shipping_settings).toEqual({ mode: 'ups_live', free_over_cents: 10000 });
});
function db(settings) {
  const data = { webstores: [{ ...store, shipping_settings: settings }], webstore_products: [{ id: 'p', product_id: 'garment', kind: 'single', retail_price: 20, active: true }], webstore_storefront_products: [{ webstore_product_id: 'p', sizes_offered: [], size_stock: {}, vendor_size_stock: {} }] };
  return { from: table => {
    const chain = { then: resolve => Promise.resolve({ data: data[table] || [], error: null }).then(resolve) };
    ['select', 'eq', 'in', 'order', 'limit', 'range', 'is', 'neq', 'gt', 'ilike'].forEach(k => chain[k] = () => chain);
    return chain;
  }, rpc: jest.fn().mockResolvedValue({ error: { message: 'Stop before creating test order' } }) };
}
test.each([
  [{ mode: 'order_total', tiers }, 8],
  [{ mode: 'item_count', tiers: [{ from: 0, amount_cents: 1200 }, { from: 3, amount_cents: 500 }] }, 5],
  [{ mode: 'flat', free_over_cents: 6000 }, 0],
  [{ mode: 'free' }, 0],
])('quote and order agree and ignore shopper shipping values: %j', async (config, fee) => {
  const sb = db(config);
  const args = { storeSlug: 'test', cart: [{ webstore_product_id: 'p', qty: 3, shipping: 0 }], ship: { street1: '1 Main St', city: 'Dallas', state: 'TX', zip: '75001' }, buyer: { name: 'Test', email: 'test@example.com' }, payMode: 'unpaid', shipping_quote: { amount: 999 }, expectedTotalCents: 6000 + fee * 100 };
  const result = await checkout.quoteTotals(sb, args);
  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body).totals).toMatchObject({ shipping: fee, total: 60 + fee });
  await checkout.placeOrder(sb, args);
  expect(sb.rpc).toHaveBeenCalledWith('place_webstore_order', expect.objectContaining({ p_order: expect.objectContaining({ shipping_fee: fee }) }));
});
