/** @jest-environment node */
const { quoteShipping, cartWeightOz } = require('../../netlify/functions/_webstoreShipping');
const checkout = require('../../netlify/functions/webstore-checkout');

const config = { mode: 'ups_live', package_weight_oz: 2, length_in: 12, width_in: 10, height_in: 3, service_code: 'ups_ground', origin_code: 'OR', fallback: 'block' };
const store = { id: 's1', slug: 'school', org_type: 'all_school', status: 'open', delivery_mode: 'ship_home', all_school_settings: { shipping: config }, flat_shipping: 99 };
const ship = { street1: '1 Main St', city: 'Dallas', state: 'TX', zip: '75001' };
const wp = { id: 'wp1', product_id: 'p1', sku: 'TEE', kind: 'single', retail_price: 20, weight_oz: 6, takes_name: false, takes_number: false, active: true };
const lines = [{ kind: 'single', wp, qty: 3 }];
function fakeSb(tables = {}) {
  const mutations = [];
  return { mutations, from(table) {
    const chain = { then: (yes, no) => Promise.resolve(tables[table] || { data: [], error: null }).then(yes, no) };
    ['select', 'eq', 'in', 'order', 'limit', 'range', 'is', 'neq', 'gt', 'ilike'].forEach((key) => { chain[key] = () => chain; });
    ['insert', 'update'].forEach((key) => { chain[key] = (row) => { mutations.push({ table, key, row }); return chain; }; });
    return chain;
  } };
}
const db = () => fakeSb({ webstores: { data: [store], error: null }, webstore_products: { data: [wp], error: null }, webstore_storefront_products: { data: [{ webstore_product_id: 'wp1', available_sizes: [], sizes_offered: [], size_stock: {}, vendor_size_stock: {} }], error: null } });

describe('server-authoritative UPS checkout rates', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.SHIPSTATION_API_KEY;
  const originalSecret = process.env.SHIPSTATION_API_SECRET;
  beforeEach(() => {
    process.env.SHIPSTATION_API_KEY = 'test-key'; process.env.SHIPSTATION_API_SECRET = 'test-secret';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ serviceCode: 'ups_ground', serviceName: 'UPS Ground', shipmentCost: 12, otherCost: 1.25 }] });
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey == null) delete process.env.SHIPSTATION_API_KEY; else process.env.SHIPSTATION_API_KEY = originalKey;
    if (originalSecret == null) delete process.env.SHIPSTATION_API_SECRET; else process.env.SHIPSTATION_API_SECRET = originalSecret;
  });

  test('uses Orange origin, physical garment quantities, packaging weight and dimensions, and includes surcharges', async () => {
    const r = await quoteShipping(db(), store, lines, { ...ship, weight_oz: 1, rate: 0, service_code: 'free' });
    expect(r.amount).toBe(13.25);
    expect(r.quote).toMatchObject({ estimated: true, weight_oz: 20, origin: { city: 'Orange', state: 'CA', zip: '92865' } });
    const [url, request] = global.fetch.mock.calls[0];
    expect(url).toBe('https://ssapi.shipstation.com/shipments/getrates');
    expect(JSON.parse(request.body)).toMatchObject({ carrierCode: 'ups', serviceCode: 'ups_ground', fromPostalCode: '92865', weight: { value: 20, units: 'ounces' }, dimensions: { units: 'inches', length: 12, width: 10, height: 3 }, residential: true });
    expect(request.redirect).toBe('error');
  });

  test('flat and team-delivery stores do not call UPS', async () => {
    expect(await quoteShipping(db(), { ...store, all_school_settings: {}, flat_shipping: 7 }, lines, ship)).toMatchObject({ amount: 7 });
    expect(await quoteShipping(db(), { ...store, delivery_mode: 'deliver_club' }, lines, null)).toMatchObject({ amount: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('missing weights block before any rate request, even with a free-shipping coupon', async () => {
    const r = await quoteShipping(db(), store, [{ ...lines[0], wp: { ...wp, weight_oz: null } }], ship, true);
    expect(r.error).toMatch(/weight is missing/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('missing package dimensions or credentials never fall back to the flat shipping amount', async () => {
    const unconfigured = { ...store, all_school_settings: { shipping: { ...config, height_in: 0 } } };
    expect((await quoteShipping(db(), unconfigured, lines, ship)).error).toMatch(/setup is incomplete/i);
    delete process.env.SHIPSTATION_API_SECRET;
    expect((await quoteShipping(db(), store, lines, ship)).error).toMatch(/not connected/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rate errors, missing service, invalid costs and timeouts fail closed', async () => {
    const responses = [
      { ok: false, json: async () => ({ message: 'provider down' }) },
      { ok: true, json: async () => [{ serviceCode: 'ups_2nd_day_air', shipmentCost: 2 }] },
      { ok: true, json: async () => [{ serviceCode: 'ups_ground', shipmentCost: null }] },
      { ok: true, json: async () => [{ serviceCode: 'ups_ground', shipmentCost: 2, otherCost: -1 }] },
    ];
    for (const response of responses) {
      global.fetch.mockResolvedValueOnce(response);
      expect((await quoteShipping(db(), store, lines, ship)).code).toBe('shipping_unavailable');
    }
    global.fetch.mockRejectedValueOnce(new Error('timed out'));
    expect((await quoteShipping(db(), store, lines, ship)).error).toMatch(/temporarily unavailable/i);
  });

  test('free shipping retains the carrier quote but charges the buyer zero', async () => {
    expect(await quoteShipping(db(), store, lines, ship, true)).toMatchObject({ amount: 0, quote: { amount: 13.25, waived: true } });
  });

  test('bundle weights count components only and refuse ambiguous catalog weights', async () => {
    const bundleLines = [{ kind: 'bundle', wp: { weight_oz: 100 }, qty: 1, components: [{ webstore_product_id: 'wp1', product_id: 'p1', qty: 2 }] }];
    expect(await cartWeightOz(db(), store, bundleLines)).toEqual({ weight_oz: 12 });
    const ambiguous = fakeSb({ webstore_products: { data: [wp, { ...wp, id: 'wp2', weight_oz: 10 }], error: null } });
    expect((await cartWeightOz(ambiguous, store, [{ ...bundleLines[0], components: [{ product_id: 'p1', qty: 2 }] }])).error).toMatch(/ambiguous/i);
  });

  test('quote endpoint uses live rates and checkout re-rates before any write, rejecting changed totals', async () => {
    const cart = [{ webstore_product_id: 'wp1', qty: 3 }];
    const quote = await checkout.quoteTotals(db(), { storeSlug: 'school', cart, ship });
    expect(quote.statusCode).toBe(200);
    expect(JSON.parse(quote.body)).toMatchObject({ totals: { subtotal: 60, shipping: 13.25, total: 73.25 }, shipping_quote: { weight_oz: 20 } });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ serviceCode: 'ups_ground', shipmentCost: 15, otherCost: 1 }] });
    const sb = db();
    const placed = await checkout.placeOrder(sb, { storeSlug: 'school', cart, ship, buyer: { name: 'Parent', email: 'parent@example.com' }, expectedTotalCents: 7325 });
    expect(placed.statusCode).toBe(409);
    expect(JSON.parse(placed.body)).toMatchObject({ code: 'totals_changed', totals: { shipping: 16 } });
    expect(sb.mutations).toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('order transaction receives only the server quote and frozen production recipe', async () => {
    const sb = fakeSb({ webstores: { data: [{ ...store, payment_mode: 'unpaid' }], error: null }, webstore_products: { data: [wp], error: null },
      webstore_storefront_products: { data: [{ webstore_product_id: 'wp1', available_sizes: [], sizes_offered: [], size_stock: {}, vendor_size_stock: {} }], error: null } });
    sb.rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'test stops at the transaction boundary' } });
    await checkout.placeOrder(sb, { storeSlug: 'school', cart: [{ webstore_product_id: 'wp1', qty: 3 }], ship,
      buyer: { name: 'Parent', email: 'parent@example.com' }, payMode: 'unpaid', expectedTotalCents: 7325,
      shipping_quote: { amount: 0, origin: 'client-forged' } });
    expect(sb.rpc).toHaveBeenCalledWith('place_webstore_order', expect.objectContaining({
      p_order: expect.objectContaining({ order_source: 'all_school', target_ship_days: 14, shipping_fee: 13.25, shipping_quote: expect.objectContaining({ amount: 13.25, weight_oz: 20, origin: { code: 'OR', city: 'Orange', state: 'CA', zip: '92865' } }) }),
      p_items: [expect.objectContaining({ qty: 3, production_recipe: expect.objectContaining({ webstore_product_id: 'wp1' }) })],
    }));
    expect(sb.mutations).toEqual([]);
  });
});

describe('all-school public data and frozen production recipes', () => {
  test('automatic mock approval requires saved setup approval and a garment image', () => {
    expect(checkout.productionRecipe({ ...wp, production_approved_at: null }).mock_approval.approved).toBe(false);
    expect(checkout.productionRecipe({ ...wp, production_approved_at: '2026-10-02T12:00:00Z', image_url: null }).mock_approval.approved).toBe(false);
    const recipe = checkout.productionRecipe({ ...wp, production_approved_at: '2026-10-02T12:00:00Z', production_approved_by: 'staff-1', image_url: 'https://assets.test/garment.jpg' });
    expect(recipe.mock_approval).toEqual({ approved: true, approved_at: '2026-10-02T12:00:00Z', approved_by: 'staff-1', basis: 'approved_store_setup' });
  });
  test('public settings expose display fields and hide supplier contacts and automation controls', () => {
    const publicStore = checkout.publicStoreRow({ ...store, contact_email: 'private@example.com', all_school_settings: { ...store.all_school_settings, programs: [{ id: 'football', name: 'Football', supplier: 'private' }], target_ship_days: 14, purchase: { threshold_cents: 20000 }, dtf: { contact_email: 'private' } } });
    expect(publicStore.all_school_settings).toEqual({ programs: [{ id: 'football', name: 'Football' }], target_ship_days: 14, shipping: { mode: 'ups_live', service_code: 'ups_ground' } });
    expect(JSON.stringify(publicStore)).not.toMatch(/private|threshold_cents|package_weight_oz/);
  });

  test('a saved recipe retains exact transfer/art version after catalog changes, without unrelated stock', () => {
    const product = { ...wp, takes_name: true, transfer_codes: ['CREST'], decorations: [{ type: 'dtf', prod_files: [{ name: 'crest.ai', url: 'https://assets.test/crest-v1.ai' }] }], personalization_template: { font: 'Varsity', uppercase: true, max_length: 12 } };
    const transfers = [{ id: 't1', code: 'CREST', production_file: 'https://assets.test/crest-v1.ai', artwork_version: 'v1', supplier: 'Astra Sport', on_hand: 50 }, { id: 't2', code: 'OTHER' }];
    product.decorations[0].art_file_id = 'a1';
    const arts = [{ id: 'a1', status: 'approved', prod_files: [{ url: 'https://assets.test/approved-v1.ai' }] }, { id: 'other-art' }];
    const recipe = checkout.productionRecipe(product, transfers, arts);
    product.decorations[0].prod_files[0].url = 'https://assets.test/crest-v2.ai'; transfers[0].artwork_version = 'v2';
    expect(recipe.decorations[0].prod_files[0].url).toMatch(/v1/);
    expect(recipe.transfer_inventory).toEqual([{ id: 't1', code: 'CREST', production_file: 'https://assets.test/crest-v1.ai', artwork_version: 'v1', supplier: 'Astra Sport' }]);
    arts[0].prod_files[0].url = 'https://assets.test/approved-v2.ai';
    expect(recipe.art_files).toEqual([{ id: 'a1', status: 'approved', prod_files: [{ url: 'https://assets.test/approved-v1.ai' }] }]);
    const saved = checkout.buildOrderItems([{ ...lines[0], production_recipe: recipe }], null, undefined, true);
    expect(saved[0].production_recipe).toBe(recipe);
    expect(checkout.buildOrderItems(lines, null)[0].production_recipe).toBeUndefined();
  });

  test('personalization rules reject invalid names without changing confirmed text', () => {
    const product = { personalization_template: { max_length: 8, uppercase: true } };
    expect(checkout.personalizationNameError(product, 'SMITH')).toBeNull();
    expect(checkout.personalizationNameError(product, 'Smith')).toMatch(/uppercase/);
    expect(checkout.personalizationNameError(product, 'TOO LONG NAME')).toMatch(/8 characters/);
    expect(checkout.personalizationNameError(product, 'A<script>')).toMatch(/characters|letters/);
  });

  test('number-transfer snapshots match tsize and legacy single design codes', () => {
    const r = checkout.productionRecipe({ ...wp, takes_number: true, transfer_code: 'CREST', num_transfer_sets: ['8in|White'] }, [
      { id: 'n1', kind: 'number', code: '7|8in|White', tsize: '8in', color: 'White', digit: '7', supplier_id: 'Astra Sport', decoration_type: 'dtf', application_method: 'heat_press' },
      { id: 'n2', kind: 'number', code: '7|6in|White', tsize: '6in', color: 'White' },
    ]);
    expect(r.transfer_codes).toEqual(['CREST']);
    expect(r.transfer_inventory).toHaveLength(1);
    expect(r.transfer_inventory[0]).toMatchObject({ tsize: '8in', digit: '7', supplier_id: 'Astra Sport', application_method: 'heat_press' });
  });

  test('package checkout freezes its exact component offering and package personalization overrides', async () => {
    const parent = { id: 'bundle1', kind: 'bundle', retail_price: 40, active: true };
    const component = { ...wp, takes_name: false, personalization_template: { max_length: 12, uppercase: true }, transfer_codes: ['STANDALONE'] };
    const sb = fakeSb({
      webstore_products: { data: [parent, component], error: null },
      webstore_bundle_items: { data: [{ bundle_id: 'bundle1', webstore_product_id: 'wp1', product_id: 'p1', sku: 'TEE', qty: 2, takes_name: true, transfer_code: 'PACKAGE' }], error: null },
      webstore_transfers: { data: [{ code: 'PACKAGE', production_file: 'https://assets.test/package.ai' }], error: null },
    });
    const priced = await checkout.priceCart(sb, store, [{ webstore_product_id: 'bundle1', components: [{ product_id: 'p1', qty: 999, size: 'M', player_name: 'SMITH' }] }]);
    expect(priced.error).toBeUndefined();
    expect(priced.lines[0].components[0]).toMatchObject({ qty: 2, player_name: 'SMITH', production_recipe: { webstore_product_id: 'wp1', takes_name: true, transfer_codes: ['PACKAGE'] } });
    const items = checkout.buildOrderItems(priced.lines, 'Player', () => 'bundle-ref', true);
    expect(items[1]).toMatchObject({ qty: 2, production_recipe: { takes_name: true } });
  });

  test('package checkout cannot guess a production recipe from ambiguous component offerings', async () => {
    const parent = { id: 'bundle1', kind: 'bundle', retail_price: 40, active: true };
    const sb = fakeSb({ webstore_products: { data: [parent, wp, { ...wp, id: 'another-sport' }], error: null },
      webstore_bundle_items: { data: [{ bundle_id: 'bundle1', product_id: 'p1', qty: 1 }], error: null } });
    const priced = await checkout.priceCart(sb, store, [{ webstore_product_id: 'bundle1', components: [{ product_id: 'p1', size: 'M' }] }]);
    expect(priced.error).toMatch(/package contents changed/i);
  });

  test('all-school number personalization can be blank and preserves a zero jersey number', async () => {
    const sb = fakeSb({ webstore_products: { data: [{ ...wp, takes_number: true }], error: null } });
    const blank = await checkout.priceCart(sb, store, [{ webstore_product_id: 'wp1', qty: 1, player_number: '' }]);
    expect(blank.error).toBeUndefined();
    expect(blank.lines[0].player_number).toBeNull();
    const zero = await checkout.priceCart(sb, store, [{ webstore_product_id: 'wp1', qty: 1, player_number: 0 }]);
    expect(zero.lines[0].player_number).toBe('0');
  });
});
