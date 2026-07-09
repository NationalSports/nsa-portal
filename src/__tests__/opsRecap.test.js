/* Tests for src/lib/opsRecap.js — the shared category rules behind My Day and the
 * emailed rep-ops-digest. Focus: the "Shipped — not invoiced" money-recovery
 * predicate (isReadyToInvoice deliberately excludes shipped orders, so an order
 * that ships without ever being invoiced must be caught by isShippedNotInvoiced)
 * and the goods-only value helper the digest uses for its dollar callouts. */

const {
  soFulfillment, isShippedNotInvoiced, isReadyToInvoice, soGoodsValue,
  quoteAgeDays, quoteColdBucket, numericSizeKeys, NON_SIZE,
} = require('../lib/opsRecap');

// Minimal SO: one line fully covered, jobs optional.
const mkSo = (over = {}) => ({
  id: 'SO-1', status: 'in_progress',
  items: [{ sku: 'TEE', sizes: { M: 10 }, unit_sell: 12, picks: [], pos: [] }],
  jobs: [],
  ...over,
});
const ff = (so) => soFulfillment(so);

describe('isShippedNotInvoiced', () => {
  test('fires on a shipped order (ShipStation flag)', () => {
    const so = mkSo({ _shipped: true });
    expect(isShippedNotInvoiced(so, ff(so))).toBe(true);
  });

  test('fires when every production job shipped', () => {
    const so = mkSo({ jobs: [{ id: 'j1', prod_status: 'shipped' }, { id: 'j2', prod_status: 'shipped' }] });
    expect(isShippedNotInvoiced(so, ff(so))).toBe(true);
  });

  test('does NOT fire without a real shipping signal', () => {
    const so = mkSo({ jobs: [{ id: 'j1', prod_status: 'completed' }] });
    expect(isShippedNotInvoiced(so, ff(so))).toBe(false);
  });

  test('completion alone is not "shipped" (manually closed orders stay out)', () => {
    const so = mkSo({ status: 'complete' });
    expect(isShippedNotInvoiced(so, ff(so))).toBe(false);
  });

  test('still fires on a shipped order that was also closed (the leak this exists for)', () => {
    const so = mkSo({ status: 'complete', _shipped: true });
    expect(isShippedNotInvoiced(so, ff(so))).toBe(true);
  });

  test('excludes promos and webstore (paid-at-checkout) orders', () => {
    const promo = mkSo({ _shipped: true, promo_applied: true });
    expect(isShippedNotInvoiced(promo, ff(promo))).toBe(false);
    const web = mkSo({ _shipped: true, source: 'webstore' });
    expect(isShippedNotInvoiced(web, ff(web))).toBe(false);
  });

  test('covers exactly the gap isReadyToInvoice leaves: shipped ⇒ not ready-to-invoice', () => {
    const so = mkSo({ _shipped: true, jobs: [{ id: 'j1', prod_status: 'shipped' }] });
    expect(isReadyToInvoice(so, ff(so))).toBe(false); // vanishes from Ready to Invoice…
    expect(isShippedNotInvoiced(so, ff(so))).toBe(true); // …and lands here instead
  });
});

describe('soGoodsValue', () => {
  test('units × unit_sell across sizes, ignoring meta keys', () => {
    const so = mkSo({ items: [{ sizes: { M: 10, L: 5, status: 'x', _meta: 1 }, unit_sell: 12 }] });
    expect(soGoodsValue(so)).toBe(180);
  });

  test('size-level sells win over unit_sell when present', () => {
    const so = mkSo({ items: [{ sizes: { M: 2, '2XL': 1 }, unit_sell: 10, _sizeSells: { '2XL': 13 } }] });
    expect(soGoodsValue(so)).toBe(2 * 10 + 13);
  });

  test('qty_only lines fall back to est_qty; free-promo lines excluded', () => {
    const so = mkSo({
      items: [
        { sizes: {}, est_qty: 4, unit_sell: 25 },
        { sizes: { M: 100 }, unit_sell: 9, is_free_promo: true },
      ],
    });
    expect(soGoodsValue(so)).toBe(100);
  });
});

describe('numericSizeKeys (mobile/desktop PO size discovery)', () => {
  // Regression: mobile check-in used SZ_ORD.includes and blanked lines whose qty
  // lived under QTY (qty_only) or OS (one-size hats/caps) — desktop already used
  // meta-exclusion and showed those buckets.
  test('accepts QTY and OS buckets that are not in SZ_ORD', () => {
    const po = {
      po_id: 'NSA 3457', vendor: 'SanMar', status: 'partial',
      OS: 24, QTY: 10, unit_cost: 12.5, drop_ship: false,
      received: { OS: 0 }, cancelled: {}, shipments: [],
    };
    expect(numericSizeKeys(po).sort()).toEqual(['OS', 'QTY']);
  });

  test('keeps apparel sizes and drops PO meta / underscore keys', () => {
    const po = {
      S: 2, M: 3, L: 1, status: 'waiting', po_id: 'PO-1', vendor: 'SanMar',
      unit_cost: 8, received: {}, cancelled: {}, shipments: [],
      _bill_details: 1, email_history: 0,
    };
    expect(numericSizeKeys(po).sort()).toEqual(['L', 'M', 'S']);
    expect(NON_SIZE.has('email_history')).toBe(true);
  });
});

describe('quote aging (shared dashboard/digest tiers)', () => {
  const now = new Date(2026, 6, 8, 12).getTime(); // Jul 8 2026 local noon

  test('ages from updated_at (locale M/D/YYYY stamp) with created_at fallback', () => {
    expect(quoteAgeDays({ updated_at: '6/28/2026, 9:15:00 AM' }, now)).toBe(10);
    expect(quoteAgeDays({ created_at: '2026-07-01T08:00:00' }, now)).toBe(7);
    expect(quoteAgeDays({}, now)).toBe(null);
  });

  test('parses two-digit-month locale stamps with their full year (no 20xx truncation)', () => {
    // The old inline regex read "12/10/2025, …" as year 2020.
    expect(quoteAgeDays({ updated_at: '12/10/2025, 3:45:12 PM' }, now)).toBe(210);
  });

  test('buckets match the dashboard todo tiers: 3-6 / 7-13 / 14+', () => {
    expect(quoteColdBucket(2)).toBe(null);
    expect(quoteColdBucket(3)).toBe('follow_up');
    expect(quoteColdBucket(6)).toBe('follow_up');
    expect(quoteColdBucket(7)).toBe('going_cold');
    expect(quoteColdBucket(13)).toBe('going_cold');
    expect(quoteColdBucket(14)).toBe('stale');
    expect(quoteColdBucket(null)).toBe(null);
  });
});
