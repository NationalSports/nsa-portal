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
const { emailRepOutOfStockRemoval, removeShortLines, stockKeyAlreadyFetched } = require('../lib/apiOrderLines');

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

  test('lists every removed item in one email', async () => {
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'buyer1', admin: makeAdmin(routes()) });
    await notify.handler(event({ so_id: 'SO-2687', po_id: 'PO 60198 POWB', vendor_name: 'SanMar', items: [
      { style: 'STC55', color: 'Black', size: 'OSFA', quantity: 1 }, { style: 'ST450', color: 'Black', size: '2XL', quantity: 1 },
    ] }));
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.subject).toContain('2 items');
    expect(sent.textContent).toContain('STC55 · Black · OSFA (qty 1)');
    expect(sent.textContent).toContain('ST450 · Black · 2XL (qty 1)');
    expect(sent.textContent).toContain('Former PO: PO 60198 POWB');
  });

  test('client helper sends ONE email per SO+PO and reports failure without throwing', async () => {
    const okFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ notified: 'rep@nsa.com' }) });
    const a = { sourceSO: 'SO-2687', sourcePO: 'PO-1', style: 'STC55', size: 'OSFA', quantity: 1 };
    const b = { sourceSO: 'SO-2687', sourcePO: 'PO-1', style: 'ST450', size: '2XL', quantity: 1 };
    const c = { sourceSO: 'SO-2700', sourcePO: 'PO-2', style: 'NL3910', size: 'XS', quantity: 1 };
    expect((await emailRepOutOfStockRemoval(okFetch, { lines: [a, b, c], vendorName: 'SanMar' })).ok).toBe(true);
    expect(okFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(okFetch.mock.calls[0][1].body).items).toHaveLength(2);
    expect((await emailRepOutOfStockRemoval(jest.fn().mockRejectedValue(new Error('offline')), { lines: [a] })).ok).toBe(false);
  });

  test('remove-all removes every short line, defers per-line email, then emails once', async () => {
    const lines = [
      { sourceSO: 'SO-2687', sourcePO: 'PO-1', style: 'STC55', size: 'OSFA', quantity: 1 },
      { sourceSO: 'SO-2687', sourcePO: 'PO-1', style: 'ST450', size: '2XL', quantity: 1 },
    ];
    const onRemoveLine = jest.fn().mockResolvedValue(true);
    const authFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const r = await removeShortLines({ lines, onRemoveLine, authFetch, vendorName: 'SanMar' });
    expect(r.removed).toHaveLength(2);
    expect(onRemoveLine.mock.calls.every(([, opts]) => opts.deferEmail)).toBe(true);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  test('remove-all stops at the first failure but still emails about what was removed', async () => {
    const lines = [{ sourceSO: 'S', sourcePO: 'P', style: 'A', size: 'M', quantity: 1 }, { sourceSO: 'S', sourcePO: 'P', style: 'B', size: 'L', quantity: 1 }, { sourceSO: 'S', sourcePO: 'P', style: 'C', size: 'XL', quantity: 1 }];
    const onRemoveLine = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const authFetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const r = await removeShortLines({ lines, onRemoveLine, authFetch });
    expect(r.removed.map(l => l.style)).toEqual(['A']);
    expect(r.failed.style).toBe('B');
    expect(onRemoveLine).toHaveBeenCalledTimes(2);
    expect(JSON.parse(authFetch.mock.calls[0][1].body).items).toHaveLength(1);
  });

  test('removing lines does not trigger a new stock lookup; a new item does', () => {
    const fetched = new Set(['A', 'B', 'C']);
    expect(stockKeyAlreadyFetched(fetched, 'A,C')).toBe(true);
    expect(stockKeyAlreadyFetched(fetched, 'A,D')).toBe(false);
    expect(stockKeyAlreadyFetched(new Set(), 'A')).toBe(false);
  });
});
