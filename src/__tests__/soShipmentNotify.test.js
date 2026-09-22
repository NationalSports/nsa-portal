/* so-shipment-notify: the coach shipping-notice endpoint.
 *
 * _shared is mocked so the handler never needs Supabase credentials — what
 * matters here is the CONTRACT: staff-only, recipient resolved from the order
 * (never from the caller), no duplicate announcements, the send recorded in the
 * so_shipment_notices ledger and NEVER on the sales_orders row (a write there
 * bumps _version and blocks the rep's next save). */

const sendVerdict = { ok: true, status: 200, userId: 'auth-1', teamMemberId: 'tm-1', role: 'rep' };
let mockVerify = { ...sendVerdict };
let mockDb;

// A plain function, not jest.fn: this project's Jest config resets mock
// implementations between tests, which would leave the gate returning undefined.
jest.mock('../../netlify/functions/_shared', () => ({
  verifyUser: async () => (mockVerify.ok ? { ...mockVerify, admin: mockDb } : mockVerify),
}));

const { handler, sendShipmentNotice } = require('../../netlify/functions/so-shipment-notify');

// Shipment records exactly as src/App.js writes them. The Ready-to-Ship modal
// (line ~21857) writes no shipment_scope; the pull modal (~20402) writes
// shipment_scope/fulfillment; a decorator transfer is scope 'deco_transfer'.
const SO = {
  id: 'NSA-18402',
  customer_id: 'cust-1',
  ship_to_id: 'default',
  _carrier: 'ups',
  _ship_date: 'Sep 21, 2026',
  deliver_on_date: 'Wed, Sep 24',
  _shipments: [
    { id: 'SHP-1', tracking_number: '1Z999AA10123456784', carrier: 'ups', ship_date: '9/21/2026', tracking_url: 'https://www.ups.com/track?tracknum=1Z999AA10123456784', label_url: null, shipstation_shipment_id: 9001, shipping_cost: 14.2, weight: 6, items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { S: 6, M: 12 } }], notes: '', created_by: 'wh-1', created_at: '9/21/2026, 1:05:00 PM' },
    { id: 'SHP-2', tracking_number: '1Z999AA10123456793', carrier: 'ups', ship_date: '9/21/2026', tracking_url: '', label_url: null, shipstation_shipment_id: null, shipping_cost: 0, weight: 5, items: [{ sku: 'RCH-112', name: '112 Trucker Cap', color: 'Navy', sizes: { OSFA: 24 } }], notes: '', created_by: 'wh-1', created_at: '9/21/2026, 1:05:00 PM' },
    // A box that went to the decorator is internal — it must not reach the coach.
    { id: 'SHP-DECO', tracking_number: '1Z000DECO', carrier: 'ups', shipment_scope: 'deco_transfer', fulfillment: false, items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { L: 99 } }], created_at: '9/21/2026, 1:05:00 PM' },
  ],
};

const ROWS = () => ({
  sales_orders: [JSON.parse(JSON.stringify(SO))],
  customers: [{ id: 'cust-1', name: 'Bolsa Grande Football', alpha_tag: 'BOLSA', primary_rep_id: 'tm-9', shipping_address_line1: '9401 Westminster Ave', shipping_city: 'Garden Grove', shipping_state: 'CA', shipping_zip: '92844' }],
  customer_contacts: [
    { name: 'Alice Booster', email: 'booster@bolsa.org', role: 'Booster', sort_order: 0 },
    { name: 'Miguel Ramirez', email: 'coach@bolsa.org', role: 'Head Coach', sort_order: 1 },
  ],
  // The order carries a THIRD line that never shipped — it must not appear.
  so_items: [
    { id: 'i1', sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', brand: 'Adidas', color: 'Navy / White' },
    { id: 'i2', sku: 'RCH-112', name: '112 Trucker Cap', brand: 'Richardson', color: 'Navy' },
    { id: 'i3', sku: 'UA-1376842', name: 'Team Tech Short Sleeve Tee', brand: 'Under Armour', color: 'Midnight Navy' },
  ],
  so_art_files: [{ id: 'af1', item_mockups: { 'AD-TI4287|Navy / White': [{ url: 'https://res.cloudinary.com/nsa/image/upload/v1/hoodie.png' }] }, archived: false }],
  so_item_decorations: [{ so_item_id: 'i1', kind: 'art', deco_type: 'screen_print', colors: 2, position: 'Left Chest', deco_index: 0 }],
  team_members: [{ id: 'tm-9', name: 'Danny Ortiz', email: 'danny@nationalsportsapparel.com', phone: '(714) 279-8777' }],
  so_shipment_notices: [],
});

let rows;
let writes;
let missingTables;

// Minimal stand-in for the supabase-js query builder: every chained filter is a
// no-op and awaiting the builder yields that table's rows. Writes are recorded.
function fakeAdmin() {
  return {
    from(table) {
      const missing = missingTables.has(table);
      const err = missing ? { code: '42P01', message: `relation "public.${table}" does not exist` } : null;
      const q = {
        _write: null,
        select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
        update(vals) { q._write = { op: 'update', vals }; return q; },
        upsert(vals, opts) { q._write = { op: 'upsert', vals, opts }; return q; },
        maybeSingle: async () => ({ data: err ? null : ((rows[table] || [])[0] || null), error: err }),
        then: (res, rej) => Promise.resolve(
          err ? { data: null, error: err }
            : q._write ? (writes.push({ table, ...q._write }), { data: null, error: null })
              : { data: rows[table] || [], error: null },
        ).then(res, rej),
      };
      return q;
    },
  };
}

const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
  .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const sentHtml = () => JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent;

const originalFetch = global.fetch;
beforeEach(() => {
  rows = ROWS();
  writes = [];
  missingTables = new Set();
  mockDb = fakeAdmin();
  mockVerify = { ...sendVerdict };
  process.env.BREVO_API_KEY = 'test-brevo-key';
  global.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ messageId: '<msg-1@brevo>' }) }));
});
afterEach(() => { global.fetch = originalFetch; });

test('rejects anything but POST', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {} });
  expect(res.statusCode).toBe(405);
});

test('refuses a caller who is not signed-in staff', async () => {
  mockVerify = { ok: false, status: 401, error: 'Missing bearer token' };
  expect(await call({ soId: 'NSA-18402' })).toMatchObject({ status: 401 });
  expect(global.fetch).not.toHaveBeenCalled();
});

test('sends to the coach contact, not the first one on file', async () => {
  const res = await call({ soId: 'NSA-18402' });
  expect(res.status).toBe(200);
  expect(res.body.to).toBe('coach@bolsa.org');
  const payload = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(payload.to).toEqual([{ email: 'coach@bolsa.org', name: 'Miguel Ramirez' }]);
  // A reply about a short size has to land on the rep's desk.
  expect(payload.replyTo).toEqual({ email: 'danny@nationalsportsapparel.com', name: 'Danny Ortiz' });
  expect(payload.sender.email).toBe('noreply@nationalsportsapparel.com');
});

test('the caller cannot introduce an email address of its own', async () => {
  const res = await call({ soId: 'NSA-18402', to: 'attacker@example.com' });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/not a contact/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('the caller may pick a different contact that the customer already has', async () => {
  const res = await call({ soId: 'NSA-18402', to: 'booster@bolsa.org' });
  expect(res.status).toBe(200);
  expect(res.body.to).toBe('booster@bolsa.org');
});

test('the email lists what is IN THE BOXES — not the rest of the order, not the decorator box', async () => {
  const res = await call({ soId: 'NSA-18402' });
  expect(res.body.boxes).toBe(2);
  expect(res.body.pieces).toBe(42); // 6 + 12 hoodies + 24 caps
  const html = sentHtml();
  expect(html).toContain('Team Issue Pullover Hoodie');
  expect(html).toContain('112 Trucker Cap');
  expect(html).toContain('Total 18 pcs');
  expect(html).toContain('Total 24 pcs');
  // The unshipped tee on the order is not in any box, so it is not in the email.
  expect(html).not.toContain('Team Tech Short Sleeve Tee');
  // The decorator transfer's 99 hoodies and its tracking never reach the coach.
  expect(html).not.toContain('1Z000DECO');
  expect(html).not.toMatch(/>\s*99\s*</);
  expect(html).toContain('1Z999AA10123456784');
  expect(html).toContain('1Z999AA10123456793');
});

test('the email is built from the order: mockup, brand, decoration, ship-to, portal link', async () => {
  await call({ soId: 'NSA-18402' });
  const html = sentHtml();
  expect(html).toContain('hoodie.png');
  expect(html).toContain('Adidas');
  expect(html).toContain('2-color screen print, Left Chest');
  expect(html).toContain('9401 Westminster Ave');
  expect(html).toContain('coach?portal=BOLSA&amp;so=NSA-18402');
  expect(html).toContain('Coach Ramirez');
});

test('a rep-supplied ETA is shown; otherwise the order’s delivery date is', async () => {
  await call({ soId: 'NSA-18402', eta: 'Fri, Sep 26' });
  expect(sentHtml()).toContain('Fri, Sep 26');
  global.fetch.mockClear();
  await call({ soId: 'NSA-18402' });
  expect(sentHtml()).toContain('Wed, Sep 24');
});

describe('the ledger', () => {
  test('records the send in so_shipment_notices and touches nothing on sales_orders', async () => {
    const res = await call({ soId: 'NSA-18402' });
    expect(res.body.historyRecorded).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('so_shipment_notices');
    expect(writes[0].op).toBe('upsert');
    expect(writes[0].opts).toEqual({ onConflict: 'so_id,shipment_sig' });
    expect(writes[0].vals).toMatchObject({ so_id: 'NSA-18402', shipment_sig: 'SHP-1,SHP-2', box_count: 2, sent_to: 'coach@bolsa.org', sent_by: 'tm-1', source: 'button', message_id: '<msg-1@brevo>' });
    expect(writes[0].vals.sent_at).toBeTruthy();
    expect(writes.some((w) => w.table === 'sales_orders')).toBe(false);
  });

  test('will not announce the same boxes twice unless told to', async () => {
    rows.so_shipment_notices = [{ so_id: 'NSA-18402', shipment_sig: 'SHP-1,SHP-2', sent_at: '2026-09-21T20:14:00Z', sent_to: 'coach@bolsa.org', sent_by: 'tm-1', source: 'button' }];
    const blocked = await call({ soId: 'NSA-18402' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.alreadySent).toMatchObject({ to: 'coach@bolsa.org' });
    expect(global.fetch).not.toHaveBeenCalled();
    const forced = await call({ soId: 'NSA-18402', resend: true });
    expect(forced.status).toBe(200);
  });

  test('a ledger row still waiting out its grace window does not block the button', async () => {
    rows.so_shipment_notices = [{ so_id: 'NSA-18402', shipment_sig: 'SHP-1,SHP-2', sent_at: null, first_tracked_at: '2026-09-21T20:00:00Z' }];
    expect((await call({ soId: 'NSA-18402' })).status).toBe(200);
  });

  test('preview reports an earlier send without sending', async () => {
    rows.so_shipment_notices = [{ so_id: 'NSA-18402', shipment_sig: 'SHP-1,SHP-2', sent_at: '2026-09-21T20:14:00Z', sent_to: 'coach@bolsa.org' }];
    const res = await call({ soId: 'NSA-18402', preview: true });
    expect(res.status).toBe(200);
    expect(res.body.alreadySent).toMatchObject({ to: 'coach@bolsa.org' });
    expect(res.body.to).toEqual({ email: 'coach@bolsa.org', name: 'Miguel Ramirez' });
    expect(res.body.contacts).toHaveLength(2);
    expect(res.body.html).toContain('Team Issue Pullover Hoodie');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test('with the ledger not deployed, the rep’s button still sends but says it was not recorded', async () => {
    missingTables.add('so_shipment_notices');
    const res = await call({ soId: 'NSA-18402' });
    expect(res.status).toBe(200);
    expect(res.body.historyRecorded).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('with the ledger not deployed, the sweep’s send is refused — it could not stop repeating itself', async () => {
    missingTables.add('so_shipment_notices');
    const { status, payload } = await sendShipmentNotice(mockDb, { soId: 'NSA-18402', requireLedger: true, requireTracking: true, source: 'sweep', sentBy: 'shipment-sweep' });
    expect(status).toBe(503);
    expect(payload.error).toMatch(/20260922210000/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

test('requireTracking refuses a box with no tracking number; the button alone may send one', async () => {
  rows.sales_orders[0]._shipments[1].tracking_number = '';
  const sweep = await sendShipmentNotice(mockDb, { soId: 'NSA-18402', requireTracking: true, sentBy: 'shipment-sweep', source: 'sweep' });
  expect(sweep.status).toBe(409);
  expect(sweep.payload.waitingOnTracking).toBe(1);
  expect(global.fetch).not.toHaveBeenCalled();
  expect((await call({ soId: 'NSA-18402' })).status).toBe(200);
});

test('a chosen subset of boxes is what gets announced and what gets recorded', async () => {
  const { status, payload } = await sendShipmentNotice(mockDb, { soId: 'NSA-18402', shipmentIds: ['SHP-1'], sentBy: 'tm-1' });
  expect(status).toBe(200);
  expect(payload.boxes).toBe(1);
  expect(sentHtml()).not.toContain('1Z999AA10123456793');
  expect(writes[0].vals.shipment_sig).toBe('SHP-1');
});

test('an order with nothing shipped yet cannot notify', async () => {
  rows.sales_orders[0]._shipments = [];
  rows.sales_orders[0]._tracking_number = null;
  expect(await call({ soId: 'NSA-18402' })).toMatchObject({ status: 409 });
});

test('an order whose tracking predates per-box records still notifies', async () => {
  rows.sales_orders[0]._shipments = [];
  rows.sales_orders[0]._tracking_number = '1ZLEGACY0001';
  const res = await call({ soId: 'NSA-18402' });
  expect(res.status).toBe(200);
  expect(res.body.boxes).toBe(1);
  expect(sentHtml()).toContain('1ZLEGACY0001');
});

test('a customer with no contact email is reported, not guessed at', async () => {
  rows.customer_contacts = [{ name: 'No Email', email: '', role: 'Coach', sort_order: 0 }];
  const res = await call({ soId: 'NSA-18402' });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/no contact with an email/i);
});

test('a soft-deleted order is not found', async () => {
  rows.sales_orders[0].deleted_at = '2026-01-01';
  expect(await call({ soId: 'NSA-18402' })).toMatchObject({ status: 404 });
});

test('a Brevo failure is surfaced and nothing is recorded as sent', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: 'invalid sender' }) }));
  const res = await call({ soId: 'NSA-18402' });
  expect(res.status).toBe(502);
  expect(writes).toHaveLength(0);
});
