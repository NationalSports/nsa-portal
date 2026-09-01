jest.mock('../../netlify/functions/_shared', () => ({ verifyQBOUser: jest.fn() }));
jest.mock('../../netlify/functions/_qb', () => ({
  getSupabaseAdmin: jest.fn(() => ({ tag: 'admin-client' })),
  getStoredTokens: jest.fn(),
  getValidAccessToken: jest.fn(),
}));

const { verifyQBOUser } = require('../../netlify/functions/_shared');
const { getStoredTokens, getValidAccessToken } = require('../../netlify/functions/_qb');
const { handler } = require('../../netlify/functions/qb-api');

const event = (action) => ({
  httpMethod: 'POST',
  headers: { origin: 'https://connect.nationalsportsapparel.com', authorization: 'Bearer test' },
  body: JSON.stringify({ action }),
});

describe('QuickBooks API role gate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('normal reps cannot even inspect QBO connection state', async () => {
    verifyQBOUser.mockResolvedValue({ ok: false, status: 403, error: 'Accounting or admin role required' });
    const response = await handler(event('connection_status'));
    expect(response.statusCode).toBe(403);
    expect(getStoredTokens).not.toHaveBeenCalled();
    expect(getValidAccessToken).not.toHaveBeenCalled();
  });

  test('accounting users see connected only after the stored grant validates', async () => {
    verifyQBOUser.mockResolvedValue({ ok: true, role: 'accounting', teamMemberId: 'acct-1' });
    getValidAccessToken.mockResolvedValue({ realm_id: 'realm-1', token_created_at: 123, access_token: 'server-only' });
    const response = await handler(event('connection_status'));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ connected: true, realm_id: 'realm-1' });
  });

  test('a stale grant reports reconnect instead of a false connected state', async () => {
    verifyQBOUser.mockResolvedValue({ ok: true, role: 'admin', teamMemberId: 'admin-1' });
    const error = new Error('refresh failed'); error.code = 'REFRESH_FAILED';
    getValidAccessToken.mockRejectedValue(error);
    const response = await handler(event('connection_status'));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ connected: false, requires_reconnect: true, code: 'REFRESH_FAILED' });
  });
});
