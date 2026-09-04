jest.mock('../../netlify/functions/_shared', () => ({
  getSupabaseAdmin: jest.fn(),
  resolveCustomerFamily: jest.fn(),
}));

const shared = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/roster-order-submit');

const call = (body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) });

describe('roster-order-submit portal authorization', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects a guessed session id without a portal credential', async () => {
    const response = await call({ session_id: 'victim-session', customer_id: 'victim' });

    expect(response.statusCode).toBe(403);
    expect(shared.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('rejects a session outside the credential-derived family and never updates it', async () => {
    const update = jest.fn();
    const sessionQuery = {
      select: () => sessionQuery,
      eq: () => sessionQuery,
      maybeSingle: async () => ({ data: { id: 'victim-session', customer_id: 'B', status: 'open' }, error: null }),
    };
    const admin = { from: jest.fn((table) => {
      if (table === 'roster_order_sessions') return { ...sessionQuery, update };
      throw new Error(`unexpected table ${table}`);
    }) };
    shared.getSupabaseAdmin.mockReturnValue(admin);
    shared.resolveCustomerFamily.mockResolvedValue({ fam: new Set(['A']) });

    const response = await call({ session_id: 'victim-session', customer_id: 'B', portal: 'opaque-token' });

    expect(response.statusCode).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
