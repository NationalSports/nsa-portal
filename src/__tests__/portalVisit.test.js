jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn(), resolveCustomerFamily: jest.fn() }));
const { getSupabaseAdmin, resolveCustomerFamily } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/portal-visit');
beforeEach(() => jest.clearAllMocks());

test('unknown portal credentials cause no analytics writes', async () => {
  const from = jest.fn();getSupabaseAdmin.mockReturnValue({ from });
  resolveCustomerFamily.mockResolvedValue({ error: 'Unknown', notFound: true });
  const result = await handler({ httpMethod: 'POST', body: '{"portal":"bad"}' });
  expect(result.statusCode).toBe(403);expect(from).not.toHaveBeenCalled();
});

test('visit updates only derived family and server-owned analytics fields', async () => {
  const calls = [];
  const from = table => {
    const call = { table, filters: [] };calls.push(call);
    const query = { update: payload => { call.payload = payload;return query; }, select: () => query,
      in: (key,value) => { call.filters.push([key,value]);return query; }, eq: () => query,
      is: () => query, not: () => query,
      then: resolve => Promise.resolve({ data: table === 'sales_orders' && !call.payload ? [{ id: 'S1' }] : [] }).then(resolve) };
    return query;
  };
  getSupabaseAdmin.mockReturnValue({ from });resolveCustomerFamily.mockResolvedValue({ fam: new Set(['C1']) });
  const result = await handler({ httpMethod: 'POST', body: '{"portal":"valid","customer_id":"OTHER","email_status":"paid"}' });
  expect(result.statusCode).toBe(200);
  for (const call of calls.filter(c => c.table !== 'so_jobs')) expect(call.filters).toContainEqual(['customer_id', ['C1']]);
  const invoice = calls.find(c => c.table === 'invoices');
  expect(invoice.payload).toEqual({ email_status: 'opened', email_opened_at: expect.any(String) });
  expect(calls.find(c => c.table === 'so_jobs').filters).toContainEqual(['so_id', ['S1']]);
});
