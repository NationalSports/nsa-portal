jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({}), verifyUser: jest.fn(), verifyAdmin: jest.fn(),
}));
const { verifyUser, verifyAdmin } = require('../../netlify/functions/_shared');
const { issuePortalCredential } = require('../../netlify/functions/_portalCredentials');
const { handler } = require('../../netlify/functions/portal-credential');

beforeEach(() => jest.clearAllMocks());

test('new links use random credentials and persist only hashes', async () => {
  const insert = jest.fn().mockReturnValue({ select: () => ({ single: async () => ({ data: { id: 'saved' } }) }) });
  const admin = { from: jest.fn().mockReturnValue({ insert }) };
  const first = await issuePortalCredential(admin, 'C1');
  const second = await issuePortalCredential(admin, 'C1');
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(first.token).not.toBe(second.token);
  expect(JSON.stringify(insert.mock.calls)).not.toContain(first.token);
  expect(insert.mock.calls[0][0]).toMatchObject({ customer_id: 'C1', credential_kind: 'token', credential_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

test('failed persistence never returns a working-looking link', async () => {
  const admin = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ error: { message: 'failed' } }) }) }) }) };
  await expect(issuePortalCredential(admin, 'C1')).rejects.toThrow('could not be saved');
});

test('anonymous calls cannot issue credentials', async () => {
  verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'issue', customer_id: 'C1' }) });
  expect(result.statusCode).toBe(401);
});

test('legacy revocation requires admin and is customer scoped', async () => {
  const query = { update: jest.fn(() => query), eq: jest.fn(() => query), select: jest.fn().mockResolvedValue({ data: [{ id: 'legacy' }] }) };
  verifyAdmin.mockResolvedValue({ ok: true, admin: { from: () => query } });
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'revoke_legacy', customer_id: 'C1' }) });
  expect(result.statusCode).toBe(200);
  expect(verifyUser).not.toHaveBeenCalled();
  expect(query.eq.mock.calls).toEqual([['customer_id', 'C1'], ['credential_kind', 'legacy_alpha_tag']]);
  expect(result.headers['Cache-Control']).toBe('no-store');
});
