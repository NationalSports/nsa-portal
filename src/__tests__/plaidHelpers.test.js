const { plaidConfig, plaidRequest, encryptToken, decryptToken, merchantKey } = require('../../netlify/functions/_plaid');

const env = { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'client', PLAID_SECRET: 'secret', PLAID_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };

afterEach(() => { delete global.fetch; });

test('encrypts provider access tokens with authenticated encryption', () => {
  const encrypted = encryptToken('access-sandbox-123', env);
  expect(encrypted).not.toContain('access-sandbox-123');
  expect(decryptToken(encrypted, env)).toBe('access-sandbox-123');
  expect(() => decryptToken(encrypted.slice(0, -2) + 'xx', env)).toThrow();
});

test('requires all provider credentials and a 32-byte encryption key', () => {
  expect(plaidConfig(env).configured).toBe(true);
  expect(plaidConfig({ ...env, PLAID_SECRET: '' }).configured).toBe(false);
  expect(plaidConfig({ ...env, PLAID_TOKEN_ENCRYPTION_KEY: 'short' }).configured).toBe(false);
  expect(plaidConfig({ ...env, PLAID_ENV: 'unknown' }).configured).toBe(false);
});

test('sends provider credentials in server headers and surfaces provider errors', async () => {
  global.fetch = jest.fn(async (_, request) => ({ ok: true, json: async () => ({ value: 'ok', sent: JSON.parse(request.body) }) }));
  await expect(plaidRequest('/test', { account: 'card' }, env)).resolves.toMatchObject({ value: 'ok', sent: { account: 'card' } });
  expect(global.fetch.mock.calls[0][1].headers).toMatchObject({ 'PLAID-CLIENT-ID': 'client', 'PLAID-SECRET': 'secret' });
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error_code: 'INVALID_INPUT', error_message: 'Bad request' }) });
  await expect(plaidRequest('/test', {}, env)).rejects.toThrow('Bad request');
});

test('normalizes merchant labels for reusable account rules', () => {
  expect(merchantKey(' T-Mobile #0042 ')).toBe('t mobile 0042');
});
