/** @jest-environment node */

/* The Bagging Station's auto label must print the origin the STORE says it ships
 * from (netlify/functions/_baggingShip.js + src/lib/shipFrom.js).
 *
 * Before this, every label printed the company address, so a parcel leaving the
 * Emerson warehouse carried a return address at a building it never touched.
 * These pin the wiring end to end: the ShipStation payload's shipFrom, and the
 * code written back onto the order so the portal can show where it shipped from. */

jest.mock('../../netlify/functions/shipstation-webhook', () => ({ processDirectShipment: jest.fn(async () => ({})) }));

const { createBagShipLabel } = require('../../netlify/functions/_baggingShip');

const baseOrder = {
  id: 'o1', store_id: 's1', ship_method: 'ship_home', created_at: '2026-09-21', payment_mode: 'paid', total: 60,
  buyer_name: 'Pat Rivera', buyer_email: 'pat@example.com',
  ship_address: { street1: '1 Main St', city: 'Orange', state: 'CA', zip: '92865' },
};
const items = [{ id: 'i1', product_id: 'p1', sku: 'NEA200', size: 'L', qty: 2, shipped_qty: 0, unit_price: 30 }];

// Chainable supabase stub that records what was written back to the order.
// `legacyDb` simulates the window where this code is live but the ship_from_code
// migration has not been applied yet: selecting that column yields no rows, and
// writing it errors the way PostgREST does for an unknown column.
function fakeSb(storeRow, writes, legacyDb = false) {
  return {
    from(table) {
      const state = { cols: '', patch: null };
      const settle = () => {
        if (table === 'webstores') {
          const askedForNewColumn = legacyDb && state.cols.includes('ship_from_code');
          return { data: askedForNewColumn ? [] : [storeRow], error: null };
        }
        if (table === 'webstore_orders' && state.patch) {
          if (legacyDb && 'ship_from_code' in state.patch) {
            return { data: null, error: { message: "column webstore_orders.ship_from_code does not exist" } };
          }
          writes.push(state.patch);
        }
        return { data: [], error: null };
      };
      const chain = {
        select: (cols) => { state.cols = String(cols || ''); return chain; },
        eq: () => chain, in: () => chain, limit: () => chain,
        update: (patch) => { state.patch = patch; return chain; },
        then: (resolve, reject) => Promise.resolve(settle()).then(resolve, reject),
      };
      return chain;
    },
  };
}

// Capture the two ShipStation calls (createorder, then createlabelfororder).
function stubShipStation(calls) {
  global.fetch = jest.fn(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    const payload = String(url).includes('createlabelfororder')
      ? { labelData: 'JVBERi0=', trackingNumber: '1Z999', shipmentId: 555, shipmentCost: 8.42 }
      : { orderId: 987 };
    return { ok: true, json: async () => payload };
  });
}

beforeEach(() => {
  process.env.SHIPSTATION_API_KEY = 'k';
  process.env.SHIPSTATION_API_SECRET = 's';
});
afterEach(() => { delete global.fetch; jest.clearAllMocks(); });

const labelCall = (calls) => calls.find((c) => c.url.includes('createlabelfororder')).body;

test("a warehouse store's label prints the warehouse as its origin", async () => {
  const calls = []; const writes = [];
  stubShipStation(calls);
  const res = await createBagShipLabel(
    fakeSb({ id: 's1', name: 'Test Store', ship_from_code: 'warehouse' }, writes),
    baseOrder, items,
  );
  expect(labelCall(calls).shipFrom).toMatchObject({ street1: '210 E Emerson Ave', postalCode: '92865', country: 'US' });
  expect(res.shipFromCode).toBe('warehouse');
  expect(writes.some((w) => w.ship_from_code === 'warehouse')).toBe(true);
});

test('a store that never chose one keeps the old company-address origin', async () => {
  const calls = []; const writes = [];
  stubShipStation(calls);
  const res = await createBagShipLabel(
    fakeSb({ id: 's1', name: 'Test Store' }, writes),
    baseOrder, items,
  );
  expect(labelCall(calls).shipFrom.street1).toBe('2238 N Glassell St Ste E');
  expect(res.shipFromCode).toBe('office');
});

test('a junk code on the store falls back rather than shipping a bad origin', async () => {
  const calls = []; const writes = [];
  stubShipStation(calls);
  await createBagShipLabel(
    fakeSb({ id: 's1', name: 'Test Store', ship_from_code: 'dock-42' }, writes),
    baseOrder, items,
  );
  expect(labelCall(calls).shipFrom.street1).toBe('2238 N Glassell St Ste E');
});

test('a database without the migration still saves the label instead of failing', async () => {
  const calls = []; const writes = [];
  stubShipStation(calls);
  const res = await createBagShipLabel(
    fakeSb({ id: 's1', name: 'Test Store' }, writes, true),
    baseOrder, items,
  );
  // The label still buys and records — it just falls back to the default origin.
  expect(res.trackingNumber).toBe('1Z999');
  expect(labelCall(calls).shipFrom.street1).toBe('2238 N Glassell St Ste E');
  const saved = writes.find((w) => 'label_data' in w);
  expect(saved).toBeTruthy();
  expect('ship_from_code' in saved).toBe(false);
});
