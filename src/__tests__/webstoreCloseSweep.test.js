/** @jest-environment node */

jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('../../netlify/functions/_webstoreClose', () => ({ notifyStoreClosed: jest.fn() }));

const { getSupabaseAdmin } = require('../../netlify/functions/_shared');
const { notifyStoreClosed } = require('../../netlify/functions/_webstoreClose');
const { handler } = require('../../netlify/functions/webstore-close-sweep');

function fakeAdmin(results) {
  const queues = {};
  Object.entries(results).forEach(([key, values]) => { queues[key] = [...values]; });
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, op: 'select', filters: [] }; calls.push(call);
      const chain = {
        select: () => chain,
        eq: (column, value) => { call.filters.push(['eq', column, value]); return chain; },
        is: (column, value) => { call.filters.push(['is', column, value]); return chain; },
        not: (column, operator, value) => { call.filters.push(['not', column, operator, value]); return chain; },
        lte: (column, value) => { call.filters.push(['lte', column, value]); return chain; },
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        then: (resolve, reject) => {
          const key = `${table}.${call.op}`;
          const result = queues[key] && queues[key].length ? queues[key].shift() : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

describe('webstore-close-sweep retry path', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('retries a previously closed store whose close notification is still incomplete', async () => {
    const store = { id: 's1', name: 'Retry Store', status: 'closed', source: 'webstore', close_at: '2026-08-31T20:00:00.000Z', closed_notified_at: null };
    const admin = fakeAdmin({
      'webstores.select': [
        { data: [], error: null },
        { data: [store], error: null },
      ],
    });
    getSupabaseAdmin.mockReturnValue(admin);
    notifyStoreClosed.mockResolvedValue({ notified: true });

    const response = await handler();

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/retried 1, notified 1/i);
    expect(notifyStoreClosed).toHaveBeenCalledWith(admin, expect.objectContaining({ id: 's1', status: 'closed' }));
    expect(admin.calls.filter((call) => call.op === 'update')).toHaveLength(0);
  });

  test('closes a newly due store before attempting notification', async () => {
    const store = { id: 's2', name: 'Due Store', status: 'open', source: 'webstore', close_at: '2026-08-31T20:00:00.000Z', closed_notified_at: null };
    const admin = fakeAdmin({
      'webstores.select': [
        { data: [store], error: null },
        { data: [], error: null },
      ],
      'webstores.update': [{ data: null, error: null }],
    });
    getSupabaseAdmin.mockReturnValue(admin);
    notifyStoreClosed.mockRejectedValue(new Error('email unavailable'));

    const response = await handler();

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/closed 1, retried 0, notified 0/i);
    expect(admin.calls.find((call) => call.op === 'update')).toBeDefined();
  });
});
