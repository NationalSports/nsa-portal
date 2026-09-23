/** @jest-environment jsdom */
/* Webstore shopper-funnel tracking: the public track endpoint's validation, the
 * storefront tracker, the funnel math, and the Reports → Webstores helpers. */
const fs = require('fs');
const path = require('path');
const { _test: track } = require('../../netlify/functions/webstore-track');
const { deviceType, setTrackedStore, trackEvent, _resetTracking } = require('../lib/webstoreTracking');
const { sumFunnel, biggestLeak } = require('../webstoreFunnel');
const { abandonedAtPayment, topItems, isLiveOrder, rangeStart } = require('../WebstoreReports');

const STORE = '11111111-2222-3333-4444-555555555555';
const PROD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('webstore-track endpoint validation', () => {
  test('keeps well-formed events and drops the rest', () => {
    const r = track.normalizeBatch({
      storeId: STORE, sessionId: 'abcdef123456', device: 'mobile',
      events: [
        { event: 'store_view' },
        { event: 'product_view', productId: PROD },
        { event: 'product_view' },                 // no product → dropped
        { event: 'order_placed' },                 // no order → dropped
        { event: 'drop_table' },                   // unknown → dropped
        { event: 'add_to_cart', productId: PROD, value: 42.129 },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.rows.map((x) => x.event)).toEqual(['store_view', 'product_view', 'add_to_cart']);
    expect(r.rows[2].value).toBe(42.13);
    expect(r.rows.every((x) => x.store_id === STORE && x.device === 'mobile')).toBe(true);
  });

  test('rejects bad store / session ids and unknown devices', () => {
    expect(track.normalizeBatch({ storeId: 'nope', sessionId: 'abcdef123456', events: [] }).error).toBeTruthy();
    expect(track.normalizeBatch({ storeId: STORE, sessionId: "x'; drop", events: [] }).error).toBeTruthy();
    const r = track.normalizeBatch({ storeId: STORE, sessionId: 'abcdef123456', device: 'fridge', events: [{ event: 'cart_view' }] });
    expect(r.rows[0].device).toBeNull();
  });

  test('caps a batch at 25 events', () => {
    const events = Array.from({ length: 60 }, () => ({ event: 'cart_view' }));
    expect(track.normalizeBatch({ storeId: STORE, sessionId: 'abcdef123456', events }).rows).toHaveLength(25);
  });

  test('migration only lets staff read, and allows exactly the tracked events', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260923120000_webstore_events.sql'), 'utf8');
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/for insert/i);
    ['store_view', 'product_view', 'add_to_cart', 'cart_view', 'checkout_start', 'order_placed'].forEach((e) => expect(sql).toContain(`'${e}'`));
  });
});

describe('storefront tracker', () => {
  beforeEach(() => { _resetTracking(); global.fetch = jest.fn(() => Promise.resolve({})); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('device detection', () => {
    expect(deviceType('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('mobile');
    expect(deviceType('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari')).toBe('tablet');
    expect(deviceType('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)')).toBe('tablet');
    expect(deviceType('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 1400)).toBe('desktop');
  });

  test('sends nothing for a closed store', () => {
    setTrackedStore(STORE, false);
    trackEvent('store_view');
    jest.runAllTimers();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('batches events, counts page views once, and never counts add-to-cart once', () => {
    setTrackedStore(STORE, true);
    trackEvent('store_view'); trackEvent('store_view');
    trackEvent('product_view', { productId: PROD }); trackEvent('product_view', { productId: PROD });
    trackEvent('add_to_cart', { productId: PROD }); trackEvent('add_to_cart', { productId: PROD });
    jest.runAllTimers();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.storeId).toBe(STORE);
    expect(body.events.map((e) => e.event)).toEqual(['store_view', 'product_view', 'add_to_cart', 'add_to_cart']);
    // the id the browser sends must pass the server's validation
    expect(track.normalizeBatch(body).error).toBeUndefined();
  });

  test('a failing network call never throws into the store', () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
    setTrackedStore(STORE, true);
    expect(() => { trackEvent('cart_view'); jest.runAllTimers(); }).not.toThrow();
  });
});

describe('funnel math', () => {
  test('sums store rows and finds the worst step', () => {
    const t = sumFunnel([
      { visitors: 60, product_viewers: 50, cart_adders: 30, checkout_starters: 10, order_placers: 9, purchasers: 8 },
      { visitors: 40, product_viewers: 30, cart_adders: 20, checkout_starters: 10, order_placers: 10, purchasers: 10 },
    ]);
    expect(t.visitors).toBe(100);
    expect(t.cart_adders).toBe(50);
    const leak = biggestLeak(t);
    expect(leak.to.key).toBe('checkout_starters'); // 50 → 20 is the worst drop
    expect(leak.lost).toBe(30);
  });

  test('no verdict on tiny samples', () => {
    expect(biggestLeak(sumFunnel([{ visitors: 5, product_viewers: 1 }]))).toBeNull();
  });
});

describe('Reports → Webstores helpers', () => {
  const o = (id, status, email, at, extra = {}) => ({ id, store_id: 's1', status, buyer_email: email, created_at: at, total: 100, payment_mode: 'paid', ...extra });

  test('a payment-screen drop that the buyer later paid is not counted as lost', () => {
    const orders = [
      o('a', 'pending_payment', 'mom@x.com', '2026-09-01T10:00:00Z'),
      o('b', 'paid', 'MOM@x.com', '2026-09-01T10:05:00Z'),
      o('c', 'pending_payment', 'dad@x.com', '2026-09-02T10:00:00Z'),
      o('d', 'cancelled', 'x@x.com', '2026-09-02T10:00:00Z'),
    ];
    expect(abandonedAtPayment(orders).map((x) => x.id)).toEqual(['c']);
    expect(orders.filter(isLiveOrder).map((x) => x.id)).toEqual(['b']);
  });

  test('top items count package components as units but skip the package line', () => {
    const rows = topItems([
      { sku: 'ab1', color: 'Navy', name: 'Tee', qty: 3, unit_price: 20, _store: 's1' },
      { sku: 'AB1', color: 'Navy', name: 'Tee', qty: 2, unit_price: 0, _store: 's2' },
      { sku: 'AB1', color: 'Navy', name: 'Tee', qty: 2, cancelled_qty: 2, unit_price: 20, _store: 's3' },
      { name: 'Pack', qty: 1, unit_price: 99, is_bundle_parent: true },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ units: 5, revenue: 60, stores: 2 });
  });

  test('date ranges', () => {
    const now = new Date('2026-09-23T12:00:00');
    expect(rangeStart('all', now)).toBeNull();
    expect(rangeStart('ytd', now).getMonth()).toBe(0);
    expect(rangeStart('30', now).getDate()).toBe(24);
  });
});
