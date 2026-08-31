function makeAdmin(routes) {
  const calls = [];
  return {
    calls,
    from(table) {
      const op = { table, filters: [] };
      const result = () => {
        const route = routes[table];
        return (typeof route === 'function' ? route(op) : route) || { data: null, error: null };
      };
      const chain = {
        select() { return chain; },
        eq(col, value) { op.filters.push(['eq', col, value]); return chain; },
        in(col, value) { op.filters.push(['in', col, value]); return chain; },
        maybeSingle() { calls.push(op); return Promise.resolve(result()); },
        then(resolve, reject) { calls.push(op); return Promise.resolve(result()).then(resolve, reject); },
      };
      return chain;
    },
  };
}

jest.mock('../../netlify/functions/_shared', () => ({ verifyUser: jest.fn() }));
const shared = require('../../netlify/functions/_shared');
const notify = require('../../netlify/functions/manual-cost-notify');

const event = (body, method = 'POST') => ({ httpMethod: method, headers: { authorization: 'Bearer test' }, body: JSON.stringify(body) });

describe('manual cost email notification', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ messageId: 'msg-1' }) });
    shared.verifyUser.mockReset();
  });

  afterEach(() => { delete process.env.BREVO_API_KEY; });

  test('emails Steve only after reading back the persisted cost and verified poster', async () => {
    const admin = makeAdmin({
      so_items: { data: [{ id: 'item-1' }], error: null },
      so_item_po_lines: { data: [{ po_id: 'PO 500 TEST', vendor: 'Office Store', memo: 'Rush supplies', created_at: '8/31/2026', sizes: { po_type: 'manual_cost', _manual_cost: 42.5, _payment_method: 'wire', _manual_cost_note: 'Rush supplies', _manual_cost_created_by_id: 'tm-1', _manual_cost_created_at: '2026-08-31T21:00:00.000Z' } }], error: null },
      sales_orders: { data: { id: 'SO-1863', customer_id: 'cust-1', memo: 'Champ Gear', created_by: 'tm-legacy' }, error: null },
      team_members: (op) => {
        const id = op.filters.find(([kind, col]) => kind === 'eq' && col === 'id')?.[2];
        return { data: id === 'tm-rep'
          ? { id: 'tm-rep', name: 'Steve Peterson', email: 'steve@nationalsportsapparel.com' }
          : { id: 'tm-1', name: 'Jered Hunt', email: 'jered@nationalsportsapparel.com' }, error: null };
      },
      customers: { data: { id: 'cust-1', name: 'College of San Mateo Football', primary_rep_id: 'tm-rep' }, error: null },
    });
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm-1', userId: 'auth-1', admin });

    const response = await notify.handler(event({ so_id: 'SO-1863', po_id: 'PO 500 TEST' }));
    expect(response.statusCode).toBe(200);
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.to).toEqual([{ email: 'steve@nationalsportsapparel.com', name: 'Steve Peterson' }]);
    expect(sent.subject).toContain('Jered Hunt');
    expect(sent.subject).toContain('SO-1863');
    expect(sent.subject).toContain('$42.50');
    expect(sent.textContent).toContain('Account: College of San Mateo Football');
    expect(sent.textContent).toContain('Sales rep: Steve Peterson (steve@nationalsportsapparel.com)');
    expect(sent.textContent).toContain('Cost amount: $42.50');
    expect(sent.textContent).toContain('Entered by (verified): Jered Hunt (jered@nationalsportsapparel.com)');
    expect(sent.textContent).toContain('Paid by: Wire');
    expect(sent.textContent).toContain('Vendor / payee: Office Store');
  });

  test('does not email when the manual cost is absent from the saved PO rows', async () => {
    const admin = makeAdmin({
      so_items: { data: [{ id: 'item-1' }], error: null },
      so_item_po_lines: { data: [], error: null },
    });
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm-1', userId: 'auth-1', admin });
    const response = await notify.handler(event({ so_id: 'SO-1863', po_id: 'PO missing' }));
    expect(response.statusCode).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('does not email when the verified user differs from the saved poster', async () => {
    const admin = makeAdmin({
      so_items: { data: [{ id: 'item-1' }], error: null },
      so_item_po_lines: { data: [{ po_id: 'PO 500 TEST', sizes: { po_type: 'manual_cost', _manual_cost: 5, _manual_cost_created_by_id: 'tm-other' } }], error: null },
    });
    shared.verifyUser.mockResolvedValue({ ok: true, teamMemberId: 'tm-1', userId: 'auth-1', admin });
    const response = await notify.handler(event({ so_id: 'SO-1863', po_id: 'PO 500 TEST' }));
    expect(response.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('escapes user-entered values in the HTML email', () => {
    const built = notify._internals.buildEmail({
      so: { id: 'SO-1', memo: '<script>alert(1)</script>' },
      customer: { name: 'A & B' },
      po: { po_id: 'PO-1', vendor: '<Store>', sizes: { _manual_cost: 5, _payment_method: 'cash', _manual_cost_note: '<b>note</b>' } },
      member: { name: 'Jered <Admin>', email: 'jered@example.com' },
      rep: { name: 'Steve & Co', email: 'steve@example.com' },
    });
    expect(built.htmlContent).not.toContain('<script>');
    expect(built.htmlContent).not.toContain('<b>note</b>');
    expect(built.htmlContent).toContain('&lt;Store&gt;');
    expect(built.htmlContent).toContain('A &amp; B');
    expect(built.htmlContent).toContain('Steve &amp; Co');
  });
});
