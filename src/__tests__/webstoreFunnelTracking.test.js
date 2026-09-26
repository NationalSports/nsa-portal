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

// ── Round 2: staff exclusion, sources, sold-out sizes, CSV, fundraising, rep alerts, reminders ──
const { isStaffBrowser, trafficSource } = require('../lib/webstoreTracking');
const { toCsv } = require('../WebstoreReports');
const { netFundraise } = require('../lib/webstoreOrderMoney');
const { netFundraise: closeNetFundraise } = require('../../netlify/functions/_webstoreClose');
const { sumSources } = require('../webstoreFunnel');
const digest = require('../../netlify/functions/rep-daily-digest')._test;
const reminder = require('../../netlify/functions/webstore-payment-reminder')._test;
const { paymentReminderHtml } = require('../../netlify/functions/_webstoreEmail');

describe('staff browsers are never tracked', () => {
  beforeEach(() => { _resetTracking(); localStorage.clear(); global.fetch = jest.fn(() => Promise.resolve({})); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); localStorage.clear(); });

  test('a portal login marks the browser as staff, and it stays marked after logout', () => {
    expect(isStaffBrowser()).toBe(false);
    localStorage.setItem('nsa_user', JSON.stringify({ id: 'x' }));
    expect(isStaffBrowser()).toBe(true);
    localStorage.removeItem('nsa_user');
    expect(isStaffBrowser()).toBe(true);
  });

  test('no events leave a staff browser', () => {
    localStorage.setItem('nsa_user', '{}');
    setTrackedStore(STORE, true);
    trackEvent('store_view');
    jest.runAllTimers();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('traffic source', () => {
  test('tagged links, roster links, referrers, and direct', () => {
    expect(trafficSource('?src=qr', '', 'x.com')).toBe('qr');
    expect(trafficSource('?utm_source=Facebook', '', 'x.com')).toBe('social');
    expect(trafficSource('?src=SMS', '', 'x.com')).toBe('text');
    expect(trafficSource('?src=reminder', '', 'x.com')).toBe('reminder');
    expect(trafficSource('?src=<script>', '', 'x.com')).toBe('other');
    expect(trafficSource('?player=abc', '', 'x.com')).toBe('roster_link');
    expect(trafficSource('', 'https://l.facebook.com/l.php?u=1', 'x.com')).toBe('social');
    expect(trafficSource('', 'https://www.google.com/', 'x.com')).toBe('search');
    expect(trafficSource('', 'https://mail.google.com/mail/u/0', 'x.com')).toBe('email');
    expect(trafficSource('', 'https://someschool.org/athletics', 'x.com')).toBe('other_site');
    expect(trafficSource('', 'https://x.com/shop/abc', 'x.com')).toBe('direct');
    expect(trafficSource('', '', 'x.com')).toBe('direct');
  });

  test('server keeps the source only on store visits, and whitelists it', () => {
    const r = track.normalizeBatch({ storeId: STORE, sessionId: 'abcdef123456', events: [
      { event: 'store_view', source: 'qr' },
      { event: 'store_view', source: 'drop table' },
      { event: 'cart_view', source: 'qr' },
    ] });
    expect(r.rows.map((x) => x.source)).toEqual(['qr', 'other', null]);
  });

  test('sources add up across stores', () => {
    const rows = sumSources([
      { store_id: 'a', source: 'qr', visitors: 5, cart_adders: 2, purchasers: 1 },
      { store_id: 'b', source: 'qr', visitors: 3, cart_adders: 1, purchasers: 1 },
      { store_id: 'b', source: 'email', visitors: 10, cart_adders: 4, purchasers: 3 },
    ]);
    expect(rows[0]).toMatchObject({ source: 'email', visitors: 10 });
    expect(rows[1]).toMatchObject({ source: 'qr', visitors: 8, purchasers: 2 });
  });
});

describe('sold-out size events', () => {
  test('need an item, and keep only a clean size list', () => {
    const r = track.normalizeBatch({ storeId: STORE, sessionId: 'abcdef123456', events: [
      { event: 'soldout_view', detail: 'S' },
      { event: 'soldout_view', productId: PROD, detail: 'S,2XL<img>' },
    ] });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].detail).toBe('S,2XLimg');
  });
});

describe('spreadsheet export', () => {
  test('quotes cells and neutralizes formulas', () => {
    const csv = toCsv(['Name', 'Units'], [['=HYPERLINK("x")', 5], ['Tee, "Navy"', -3]]);
    expect(csv).toBe('"Name","Units"\r\n"\'=HYPERLINK(""x"")","5"\r\n"Tee, ""Navy""","-3"');
  });
});

describe('fundraising owed is the same everywhere', () => {
  test('shared helper matches the store-close email', () => {
    const cases = [
      { subtotal: 100, fundraise_amt: 20, discount_amt: 0 },
      { subtotal: 100, fundraise_amt: 20, discount_amt: 30 },
      { subtotal: 50, fundraise_amt: 10, discount_amt: 999 },
      { subtotal: 0, fundraise_amt: 5, discount_amt: 0 },
      { subtotal: 80, fundraise_amt: 0, discount_amt: 10 },
    ];
    cases.forEach((o) => expect(netFundraise(o)).toBe(closeNetFundraise(o)));
    expect(netFundraise({ subtotal: 100, fundraise_amt: 20, discount_amt: 30 })).toBe(15);
  });
});

describe('rep digest: closing-this-week alert', () => {
  test('flags carts that have not ordered', () => {
    const line = digest.closingLine({ daysLeft: 3, visitors: 90, cartAdders: 40, purchasers: 12, notOrdered: 28 });
    expect(line).toMatch(/closes in 3 days/);
    expect(line).toMatch(/28 still haven't ordered/);
    expect(digest.closingLine({ daysLeft: 1, visitors: 0 })).toMatch(/within a day · no shopper visits/);
  });

  test('a rep with only closing stores still gets a useful subject and email', () => {
    const closing = [{ store: { id: 's1', name: 'Lincoln <Soccer>', rep_id: 'r' }, daysLeft: 2, visitors: 10, cartAdders: 5, purchasers: 1, notOrdered: 4 }];
    expect(digest.digestSubject([], [], 'Monday', closing)).toBe('Lincoln <Soccer> closes this week (Monday)');
    expect(digest.digestSubject([], [], 'Monday', [...closing, ...closing])).toBe('2 of your stores close this week (Monday)');
    const html = digest.buildDigestHtml({ rep: { name: 'Sam' }, storesArr: [], closed: [], closing, dayLabel: 'Monday', portal: 'https://p' });
    expect(html).toContain('Closing this week');
    expect(html).toContain('Lincoln &lt;Soccer&gt;');
    expect(html).toContain('4 still haven\'t ordered');
  });

  test('closed stores link to the portal Orders tab and show whole-store totals', () => {
    const closed = [{ id: 'st1', name: 'Girls Hoops', slug: 'gh', _stats: { orders: 3, items: 7, sales: 150, fund: 0 } }];
    const html = digest.buildDigestHtml({ rep: { name: 'Sam' }, storesArr: [], closed, closing: [], dayLabel: 'Monday', portal: 'https://p' });
    expect(html).toContain('https://p/?pg=webstores&store=st1&tab=orders');
    expect(html).not.toContain('https://p/shop/gh');
    expect(html).toContain('3 orders · 7 items · $150.00');
    expect(html).toContain("here's what changed below");
    expect(digest.closedStatsLine({ orders: 0, items: 0, sales: 0, fund: 0 })).toBe('No orders placed');
    expect(digest.closedStatsLine(undefined)).toBe('');
  });

  test('loads open stores closing within 7 days and survives a tracking error', async () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const q = { select: () => q, eq: () => q, not: () => q, gt: () => q, lte: () => Promise.resolve({ data: [{ id: 's1', name: 'A', rep_id: 'r', close_at: '2026-09-26T12:00:00Z', status: 'open' }] }) };
    const admin = { from: () => q, rpc: () => Promise.reject(new Error('boom')) };
    const out = await digest.loadClosingSoon(admin, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ daysLeft: 3, visitors: 0, notOrdered: 0 });
  });
});

describe('"finish your order" reminder rules', () => {
  const now = new Date('2026-09-23T12:00:00Z').getTime();
  const hoursAgo = (h) => new Date(now - h * 3600000).toISOString();
  const store = { id: 's1', status: 'open', close_at: '2026-10-01T00:00:00Z' };
  const base = { id: 'o1', store_id: 's1', status: 'pending_payment', payment_mode: 'paid', buyer_email: 'mom@x.com', stripe_pi_id: 'pi_1', created_at: hoursAgo(5), payment_reminder_sent_at: null };

  test('qualifies a stalled card checkout', () => {
    expect(reminder.skipReason(base, store, [base], now)).toBeNull();
  });
  test('waits 3 hours and gives up after 48', () => {
    expect(reminder.skipReason({ ...base, created_at: hoursAgo(1) }, store, [], now)).toBe('age');
    expect(reminder.skipReason({ ...base, created_at: hoursAgo(60) }, store, [], now)).toBe('age');
  });
  test('never after the store closes', () => {
    expect(reminder.skipReason(base, { ...store, status: 'closed' }, [], now)).toBe('store-closed');
    expect(reminder.skipReason(base, { ...store, close_at: hoursAgo(1) }, [], now)).toBe('store-closed');
  });
  test('not if the buyer ordered since, or was already reminded for this store', () => {
    expect(reminder.skipReason(base, store, [base, { id: 'o2', status: 'paid', created_at: hoursAgo(4) }], now)).toBe('bought-since');
    expect(reminder.skipReason(base, store, [base, { id: 'o3', status: 'pending_payment', created_at: hoursAgo(20), payment_reminder_sent_at: hoursAgo(10) }], now)).toBe('buyer-already-reminded');
    expect(reminder.skipReason({ ...base, payment_reminder_sent_at: hoursAgo(1) }, store, [], now)).toBe('already-reminded');
  });
  test('email escapes buyer and item text', () => {
    const html = paymentReminderHtml({ store: { name: 'Lincoln', slug: 'lincoln', close_at: null }, order: { buyer_name: '<b>Mom</b>' }, items: [{ name: 'Tee <x>', size: 'M', qty: 2 }], portal: 'https://p' });
    expect(html).toContain('/shop/lincoln/cart?src=reminder');
    expect(html).not.toContain('<b>Mom</b>');
    expect(html).toContain('Tee &lt;x&gt;');
    expect(html).toContain('haven’t been charged');
  });
});

describe('the reminder only emails when Stripe says the payment never happened', () => {
  test('bank transfers still settling are skipped', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../netlify/functions/webstore-payment-reminder.js'), 'utf8');
    expect(src).toMatch(/REMINDABLE_PI = new Set\(\['requires_payment_method', 'requires_confirmation'\]\)/);
    expect(src).toMatch(/WEBSTORE_PAYMENT_REMINDERS/);
  });
});
