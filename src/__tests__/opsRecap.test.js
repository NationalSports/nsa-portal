/* Tests for src/lib/opsRecap.js — the shared category rules behind My Day and the
 * emailed rep-ops-digest. Focus: the "Shipped — not invoiced" money-recovery
 * predicate (isReadyToInvoice deliberately excludes shipped orders, so an order
 * that ships without ever being invoiced must be caught by isShippedNotInvoiced)
 * and the goods-only value helper the digest uses for its dollar callouts. */

const {
  soFulfillment, isShippedNotInvoiced, isReadyToInvoice, soGoodsValue,
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
