/* so-shipment-notify: the coach shipping-notice endpoint.
 *
 * _shared is mocked so the handler never needs Supabase credentials — what
 * matters here is the CONTRACT: staff-only, recipient resolved from the order
 * (never from the caller), no duplicate announcements, and an audit row on the
 * order after a send. */

const sendVerdict = { ok: true, status: 200, userId: 'auth-1', teamMemberId: 'tm-1', role: 'rep' };
let mockVerify = { ...sendVerdict };
let mockDb;

// A plain function, not jest.fn: this project's Jest config resets mock
// implementations between tests, which would leave the gate returning undefined.
jest.mock('../../netlify/functions/_shared', () => ({
  verifyUser: async () => (mockVerify.ok ? { ...mockVerify, admin: mockDb } : mockVerify),
}));

const { handler } = require('../../netlify/functions/so-shipment-notify');

const SO = {
  id: 'NSA-18402',
  customer_id: 'cust-1',
  ship_to_id: 'default',
  _carrier: 'ups',
  _ship_date: 'Sep 21, 2026',
  deliver_on_date: 'Wed, Sep 24',
  sent_history: [],
  _shipments: [
    { id: 'SHP-1', tracking_number: '1Z999AA10123456784', carrier: 'ups', ship_date: 'Sep 21, 2026', items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { S: 6, M: 12 } }] },
    { id: 'SHP-2', tracking_number: '1Z999AA10123456793', carrier: 'ups', ship_date: 'Sep 21, 2026', items: [{ sku: 'RCH-112', name: '112 Trucker Cap', color: 'Navy', sizes: { OSFA: 24 } }] },
    // A box that went to the decorator is internal — it must not reach the coach.
    { id: 'SHP-DECO', tracking_number: '1Z000DECO', carrier: 'ups', shipment_scope: 'deco_transfer', items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { L: 99 } }] },
  ],
};

const ROWS = () => ({
  sales_orders: [JSON.parse(JSON.stringify(SO))],
  customers: [{ id: 'cust-1', name: 'Bolsa Grande Football', alpha_tag: 'BOLSA', primary_rep_id: 'tm-9', shipping_address_line1: '9401 Westminster Ave', shipping_city: 'Garden Grove', shipping_state: 'CA', shipping_zip: '92844' }],
  customer_contacts: [
    { name: 'Alice Booster', email: 'booster@bolsa.org', role: 'Booster', sort_order: 0 },
    { name: 'Miguel Ramirez', email: 'coach@bolsa.org', role: 'Head Coach', sort_order: 1 },
  ],
  so_items: [
    { id: 'i1', sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', brand: 'Adidas', color: 'Navy / White' },
    { id: 'i2', sku: 'RCH-112', name: '112 Trucker Cap', brand: 'Richardson', color: 'Navy' },
  ],
  so_art_files: [{ id: 'af1', item_mockups: { 'AD-TI4287|Navy / White': [{ url: 'https://res.cloudinary.com/nsa/image/upload/v1/hoodie.png' }] }, archived: false }],
  so_item_decorations: [{ so_item_id: 'i1', kind: 'art', deco_type: 'screen_print', colors: 2, position: 'Left Chest', deco_index: 0 }],
  team_members: [{ id: 'tm-9', name: 'Danny Ortiz', email: 'danny@nationalsportsapparel.com', phone: '(714) 279-8777' }],
});

let rows;
let updates;

// Minimal stand-in for the supabase-js query builder: every chained filter is a
// no-op and awaiting the builder yields that table's rows.
function fakeAdmin() {
  return {
    from(table) {
      const q = {
        _update: null,
        select: () => q, eq: () => q, in: () => q, order: () => q,
        update(vals) { q._update = vals; return q; },
        maybeSingle: async () => ({ data: (rows[table] || [])[0] || null, error: null }),
        then: (res, rej) => Promise.resolve(
          q._update ? (updates.push({ table, vals: q._update }), { data: null, error: null })
            : { data: rows[table] || [], error: null },
        ).then(res, rej),
      };
      return q;
    },
  };
}

const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
  .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

const originalFetch = global.fetch;
beforeEach(() => {
  rows = ROWS();
  updates = [];
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

test('only customer boxes are announced — a decorator transfer is not', async () => {
  const res = await call({ soId: 'NSA-18402' });
  expect(res.body.boxes).toBe(2);
  expect(res.body.pieces).toBe(42); // 6 + 12 hoodies + 24 caps, never the 99 at the decorator
  const html = JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent;
  expect(html).toContain('1Z999AA10123456784');
  expect(html).not.toContain('1Z000DECO');
});

test('the email is built from the order: mockup, brand, decoration, ship-to, portal link', async () => {
  await call({ soId: 'NSA-18402' });
  const html = JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent;
  expect(html).toContain('hoodie.png');
  expect(html).toContain('Adidas');
  expect(html).toContain('2-color screen print, Left Chest');
  expect(html).toContain('9401 Westminster Ave');
  expect(html).toContain('coach?portal=BOLSA&amp;so=NSA-18402');
  expect(html).toContain('Coach Ramirez');
});

test('a rep-supplied ETA is shown; otherwise the order’s delivery date is', async () => {
  await call({ soId: 'NSA-18402', eta: 'Fri, Sep 26' });
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent).toContain('Fri, Sep 26');
  global.fetch.mockClear();
  await call({ soId: 'NSA-18402' });
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent).toContain('Wed, Sep 24');
});

test('records the send on the order', async () => {
  const res = await call({ soId: 'NSA-18402' });
  expect(res.body.historyRecorded).toBe(true);
  const hist = updates[0].vals.sent_history;
  expect(updates[0].table).toBe('sales_orders');
  expect(hist[hist.length - 1]).toMatchObject({ type: 'shipment', to: 'coach@bolsa.org', boxes: 2, messageId: '<msg-1@brevo>', sent_by: 'tm-1' });
  // The order-document email status is a different thing and must not be touched.
  expect(updates[0].vals.email_status).toBeUndefined();
});

test('will not announce the same boxes twice unless told to', async () => {
  rows.sales_orders[0].sent_history = [{ type: 'shipment', to: 'coach@bolsa.org', sent_at: '9/21/2026', shipment_sig: 'SHP-1,SHP-2' }];
  const blocked = await call({ soId: 'NSA-18402' });
  expect(blocked.status).toBe(409);
  expect(global.fetch).not.toHaveBeenCalled();
  const forced = await call({ soId: 'NSA-18402', resend: true });
  expect(forced.status).toBe(200);
});

test('a new box after an earlier notice is a different announcement', async () => {
  rows.sales_orders[0].sent_history = [{ type: 'shipment', to: 'coach@bolsa.org', sent_at: '9/21/2026', shipment_sig: 'SHP-1' }];
  expect((await call({ soId: 'NSA-18402' })).status).toBe(200);
});

test('preview never sends, and tells the rep who it would go to', async () => {
  const res = await call({ soId: 'NSA-18402', preview: true });
  expect(res.status).toBe(200);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(res.body.to).toEqual({ email: 'coach@bolsa.org', name: 'Miguel Ramirez' });
  expect(res.body.contacts).toHaveLength(2);
  expect(res.body.html).toContain('Team Issue Pullover Hoodie');
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
  expect(JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent).toContain('1ZLEGACY0001');
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
  expect(updates).toHaveLength(0);
});
