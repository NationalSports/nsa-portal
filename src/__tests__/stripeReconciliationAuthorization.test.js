/** @jest-environment node */

jest.mock('stripe', () => jest.fn());
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: jest.fn(() => ({ 'Access-Control-Allow-Origin': '*' })),
  getSupabaseAdmin: jest.fn(),
  verifyQBOUser: jest.fn(),
}));

const { getSupabaseAdmin, verifyQBOUser } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/stripe-reconciliation');

const event = (body) => ({
  httpMethod: 'POST',
  headers: { origin: 'https://connect.nationalsportsapparel.com', authorization: 'Bearer test' },
  body: JSON.stringify(body),
});

describe('Stripe reconciliation finance role gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normal reps cannot inspect company payout data', async () => {
    verifyQBOUser.mockResolvedValue({ ok: false, status: 403, error: 'Accounting or admin role required' });
    const response = await handler(event({ action: 'list_payouts' }));
    expect(response.statusCode).toBe(403);
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  test('rejects a malformed historical payout ID before calling Stripe', async () => {
    verifyQBOUser.mockResolvedValue({ ok: true, role: 'accounting' });
    getSupabaseAdmin.mockReturnValue({});
    const response = await handler(event({ action: 'reconcile_payout', payout_id: 'not-a-payout' }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/payout_id/i);
  });
});
