function makeAdmin(routes) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle() { return Promise.resolve(routes[table] || { data: null, error: null }); },
      };
      return chain;
    },
  };
}

jest.mock('../../netlify/functions/_shared', () => ({ verifyUser: jest.fn() }));
const shared = require('../../netlify/functions/_shared');
const notify = require('../../netlify/functions/oos-removal-notify');
const { emailRepOutOfStockRemoval } = require('../lib/apiOrderLines');

const event = (body, method = 'POST') => ({ httpMethod: method, headers: { authorization: 'Bearer test' }, body: JSON.stringify(body) });
const line = { so_id: 'SO-2742', po_id: 'PO-9001', vendor_name: 'SanMar', style: 'STC55', color: 'Black', size: 'OSFA', quantity: 1 };
const routes = (repEmail = 'rep@nsa.com') => ({
  sales_orders: { data: { id: 'SO-2742', customer_id: 'c1', created_by: 'creator' }, error: null },
  customers: { data: { id: 'c1', name: 'Lincoln High', primary_rep_id: 'rep1' }, error: null },
  team_members: { data: { id: 'rep1', name: 'Rita Rep', email: repEmail }, error: null },
});

describe('out-of-stock removal email', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: 'msg-1' }) });
    shared.verifyUser.mockReset();
  });
  afterEach(() => { delete process.env.BREVO_API_KEY; });

  test('emails the rep with item, out-of-stock notice, former PO, SO and a link', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'buyer1', admin: makeAdmin(routes()) });
    const res = await notify.handler(event(line));
    expect(res.statusCode).toBe(200);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.to[0].email).toBe('rep@nsa.com');
    expect(sent.textContent).toMatch(/OUT OF STOCK at SanMar/);
    expect(sent.textContent).toContain('Former PO: PO-9001');
    expect(sent.textContent).toContain('Sales order: SO-2742');
    expect(sent.textContent).toContain('STC55 · Black · OSFA');
    expect(sent.htmlContent).toContain('https://connect.nationalsportsapparel.com/?pg=orders&so=SO-2742');
  });

  test('falls back to the office inbox when the rep has no email, so the alert is never dropped', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'buyer1', admin: makeAdmin(routes('')) });
    const res = await notify.handler(event(line));
    expect(JSON.parse(res.body).usedFallback).toBe(true);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).to[0].email).toBe(notify._internals.FALLBACK_EMAIL);
  });

  test('escapes HTML in client-supplied item text and rejects unauthenticated / incomplete requests', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'buyer1', admin: makeAdmin(routes()) });
    await notify.handler(event({ ...line, style: '<script>x</script>' }));
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).htmlContent).not.toContain('<script>');
    expect((await notify.handler(event({ so_id: 'SO-1' }))).statusCode).toBe(400);
    shared.verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'no' });
    expect((await notify.handler(event(line))).statusCode).toBe(401);
  });

  test('client helper posts the removed line and reports failure without throwing', async () => {
    const okFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ notified: 'rep@nsa.com' }) });
    const args = { line: { sourcePO: 'PO-9001', style: 'STC55', color: 'Black', size: 'OSFA', quantity: 1 }, sourceOrder: { id: 'SO-2742' }, vendorName: 'SanMar' };
    expect((await emailRepOutOfStockRemoval(okFetch, args)).ok).toBe(true);
    expect(JSON.parse(okFetch.mock.calls[0][1].body)).toMatchObject({ so_id: 'SO-2742', po_id: 'PO-9001', size: 'OSFA' });
    expect((await emailRepOutOfStockRemoval(jest.fn().mockRejectedValue(new Error('offline')), args)).ok).toBe(false);
  });
});
