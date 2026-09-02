/** @jest-environment node */

/* Guards on the Bagging Station's auto ship label (netlify/functions/_baggingShip.js).
 *
 * These pin the review fixes: an OPEN short must block the label (nothing has
 * decided yet whether the piece is found/backordered/refunded — a label now
 * would ship-and-mark-shipped units that aren't in the box), and OMG
 * school-delivery sales must never get per-player labels even when the
 * ingested slip stamped ship_home. No ShipStation call is ever reached in
 * these paths, so fetch is stubbed to throw if touched. */
const { createBagShipLabel, labelWeightLbs } = require('../../netlify/functions/_baggingShip');

// Chainable supabase stub (same pattern as webstoreCheckout.test.js).
function fakeSb(tables) {
  return {
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, limit: () => chain,
        update: () => chain,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const baseOrder = {
  id: 'o1', store_id: 's1', ship_method: 'ship_home', created_at: '2026-08-12',
  ship_address: { street1: '1 Main St', city: 'Orange', state: 'CA', zip: '92865' },
};
const webstoreRow = (over = {}) => ({ data: [{ id: 's1', name: 'Test Store', ...over }], error: null });

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error('ShipStation must not be called in a skip path'); });
});
afterEach(() => { delete global.fetch; });

test('open short skips the auto label instead of shipping missing units', async () => {
  const sb = fakeSb({ webstores: webstoreRow() });
  const items = [
    { id: 'i1', qty: 2, shipped_qty: 0, missing_qty: 0, short_qty: 2, short_status: 'open', sku: 'TEE' },
    { id: 'i2', qty: 1, shipped_qty: 0, missing_qty: 0, sku: 'HOOD' },
  ];
  const r = await createBagShipLabel(sb, baseOrder, items);
  expect(r.skipped).toBe(true);
  expect(r.reason).toMatch(/open short/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('OMG school-delivery sale never buys a per-player label', async () => {
  const sb = fakeSb({
    webstores: webstoreRow({ source: 'omg', omg_sale_code: 'ABC123' }),
    omg_stores: { data: [{ delivery_mode: 'deliver_school' }], error: null },
  });
  const items = [{ id: 'i1', qty: 1, shipped_qty: 0, missing_qty: 0, sku: 'TEE' }];
  const r = await createBagShipLabel(sb, baseOrder, items);
  expect(r.skipped).toBe(true);
  expect(r.reason).toMatch(/school/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('non ship-home and auto-label-off still skip', async () => {
  const pickup = await createBagShipLabel(fakeSb({}), { ...baseOrder, ship_method: 'pickup' }, []);
  expect(pickup.skipped).toBe(true);
  const off = await createBagShipLabel(
    fakeSb({ webstores: webstoreRow({ bagging_auto_label: false }) }), baseOrder,
    [{ id: 'i1', qty: 1, sku: 'TEE' }],
  );
  expect(off.skipped).toBe(true);
});

test('resolved shorts leave nothing to ship when they cover the order', async () => {
  // refunded short resolved: missing_qty set — the only line nets to zero
  const sb = fakeSb({ webstores: webstoreRow() });
  const items = [{ id: 'i1', qty: 2, shipped_qty: 0, missing_qty: 2, short_qty: 2, short_status: 'refunded', sku: 'TEE' }];
  const r = await createBagShipLabel(sb, baseOrder, items);
  expect(r.skipped).toBe(true);
  expect(r.reason).toMatch(/nothing to ship/i);
});

test('catalog weight of 0 falls back to the keyword estimate', () => {
  const items = [{ product_id: 'p1', sku: 'HOODIE-M', qty: 1 }];
  const zeroOverride = labelWeightLbs(items, {}, { p1: 0 });
  const realOverride = labelWeightLbs(items, {}, { p1: 32 });
  expect(zeroOverride).toBeCloseTo(18 / 16, 1); // hoodie keyword estimate, not 0
  expect(realOverride).toBeCloseTo(2.0, 1);
});
