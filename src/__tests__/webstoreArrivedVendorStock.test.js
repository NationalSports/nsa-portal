/* Landed-but-not-yet-resynced vendor stock (src/Webstores.js).
 *
 * Vendor inventory is a synced snapshot. A size the last sync recorded as 0-on-hand
 * with units due on a date that has since passed is stock we can source — the row
 * just hasn't been refreshed. Counting it as unavailable invented shortfalls:
 * JL5412 "Techfit VB Shorts W" was synced 2026-07-31 with M 5" / XL5" at 0 on hand
 * and 103 / 17 units due 2026-08-03, so on 2026-08-05 a two-unit batch reported
 * "need 2, have 0 (0 ours + 0 Adidas) — more on order" with the goods in Adidas'
 * warehouse.
 *
 * These exercise the SAME functions the batch shortfall check and the stock report
 * call (arrivedVendorQty → lineStock → aggStock), not a reimplementation.
 */
const { arrivedVendorQty, lineStock, aggStock } = require('../Webstores');

const TODAY = '2026-08-05';

// The real JL5412 storefront row as of the report: 3"/4" runs in stock, the whole
// 5" run at 0 with a delivery dated two days ago.
const JL5412 = {
  name: 'Adidas Techfit VB Shorts W',
  size_stock: {},
  vendor_size_stock: { 'M 3"': 13750, 'M 4"': 7852, 'M 5"': 0, 'XL5"': 0, 'L 5"': 0 },
  vendor_size_eta: { 'M 5"': '2026-08-03', 'XL5"': '2026-08-03', 'L 5"': '2026-08-03' },
  vendor_size_incoming: { 'M 5"': 103, 'XL5"': 17, 'L 5"': 13 },
  vendor_synced_at: '2026-07-31T21:42:58.009Z',
  vendor_eta: '2026-08-03',
};
const stockByPid = { p1: JL5412 };
const line = (size, qty) => ({ product_id: 'p1', sku: 'JL5412', size, qty });

describe('arrivedVendorQty', () => {
  test('credits a delivery whose date has passed', () => {
    expect(arrivedVendorQty(JL5412.vendor_size_eta, JL5412.vendor_size_incoming, 'M 5"', TODAY)).toBe(103);
  });
  test('credits a delivery dated today', () => {
    expect(arrivedVendorQty({ M: '2026-08-05' }, { M: 40 }, 'M', TODAY)).toBe(40);
  });
  test('does NOT credit a delivery still in the future', () => {
    expect(arrivedVendorQty({ M: '2026-09-01' }, { M: 40 }, 'M', TODAY)).toBe(0);
  });
  test('a passed date with no recorded inbound quantity credits nothing', () => {
    // Vendors other than Adidas leave future_delivery_qty null — they must keep
    // behaving exactly as before rather than getting free phantom stock.
    expect(arrivedVendorQty({ M: '2026-08-03' }, {}, 'M', TODAY)).toBe(0);
    expect(arrivedVendorQty({ M: '2026-08-03' }, { M: null }, 'M', TODAY)).toBe(0);
  });
  test('ignores junk / missing dates', () => {
    expect(arrivedVendorQty({ M: 'soon' }, { M: 40 }, 'M', TODAY)).toBe(0);
    expect(arrivedVendorQty(null, null, 'M', TODAY)).toBe(0);
  });
  test('a size with stock on hand is untouched (no eta row is published for it)', () => {
    expect(arrivedVendorQty(JL5412.vendor_size_eta, JL5412.vendor_size_incoming, 'M 3"', TODAY)).toBe(0);
  });
});

describe('lineStock surfaces the landed delivery alongside the on-hand number', () => {
  test('0 on hand + 103 landed, with the date and snapshot age for the label', () => {
    const ls = lineStock(line('M 5"', 2), stockByPid, {}, new Set());
    expect(ls.vendor).toBe(0);
    expect(ls.arrived).toBe(103);
    expect(ls.arrivedEta).toBe('2026-08-03');
    expect(ls.syncedAt).toBe('2026-07-31T21:42:58.009Z');
  });
  test('an in-stock size reports its real count and no credit', () => {
    const ls = lineStock(line('M 3"', 2), stockByPid, {}, new Set());
    expect(ls.vendor).toBe(13750);
    expect(ls.arrived).toBe(0);
  });
});

describe('aggStock — the shortfall math the batch modal and stock report share', () => {
  test('the reported case: 2 units of a landed 5" size is NOT a backorder', () => {
    const [r] = aggStock([line('M 5"', 1), line('M 5"', 1)], stockByPid);
    expect(r.need).toBe(2);
    expect(r.vendorAvail).toBe(103);
    expect(r.backorder).toBe(0);
    expect(r.poVendor).toBe(2);
  });
  test('demand beyond the landed quantity still backorders the remainder', () => {
    const [r] = aggStock([line('XL5"', 20)], stockByPid); // 17 landed
    expect(r.vendorAvail).toBe(17);
    expect(r.poVendor).toBe(17);
    expect(r.backorder).toBe(3);
  });
  test('a size with neither stock nor a landed delivery is still short', () => {
    const [r] = aggStock([line('2XL5', 2)], stockByPid);
    expect(r.vendorAvail).toBe(0);
    expect(r.backorder).toBe(2);
  });
});
