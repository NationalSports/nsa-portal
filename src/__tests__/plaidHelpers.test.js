const { plaidConfig, plaidRequest, encryptToken, decryptToken, merchantKey, collectTransactions, syncConnection } = require('../../netlify/functions/_plaid');

const env = { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'client', PLAID_SECRET: 'secret', PLAID_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };

let previousEnv;
beforeEach(() => { previousEnv = { ...process.env }; Object.assign(process.env, env); });
afterEach(() => { delete global.fetch; process.env = previousEnv; });

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

test('collects more than five pages and discards partial pages when Plaid reports a pagination mutation', async () => {
  const requested = []; let mutationSent = false;
  global.fetch = jest.fn(async (_, request) => {
    const { cursor } = JSON.parse(request.body); requested.push(cursor);
    if (cursor === 'page1' && !mutationSent) {
      mutationSent = true;
      return { ok: false, json: async () => ({ error_code: 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' }) };
    }
    const page = cursor === 'original' ? 0 : Number(cursor.slice(4));
    return { ok: true, json: async () => ({ added: [{ transaction_id: mutationSent ? `stable-${page}` : 'discard-me' }],
      modified: [], removed: [], next_cursor: `page${page + 1}`, has_more: page < 6 }) };
  });
  const result = await collectTransactions('access', 'original', Date.now() + 20000);
  expect(requested.slice(0, 3)).toEqual(['original', 'page1', 'original']);
  expect(result.changed).toHaveLength(7); expect(result.changed.some(row => row.transaction_id === 'discard-me')).toBe(false);
  expect(result.cursor).toBe('page7');
});

test('failed later page does not yield any partial result', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ added: [{ transaction_id: 'partial' }], has_more: true, next_cursor: 'next' }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'Reconnect required' }) });
  await expect(collectTransactions('access', null, Date.now() + 20000)).rejects.toThrow('Reconnect required');
});

function syncAdmin(connection) {
  const updates = [];
  const admin = { rpc: jest.fn(async () => ({ data: null })), from: jest.fn(() => {
    const q = { update: values => { updates.push(values); return q; }, eq: () => q, neq: () => q, or: () => q, select: () => q,
      maybeSingle: async () => ({ data: connection }), then: resolve => Promise.resolve({ data: null }).then(resolve) };
    return q;
  }), updates };
  return admin;
}

test('sync uses the claimed current cursor, commits once, and never writes previously read review fields', async () => {
  const connection = { id: 'c1', status: 'active', access_token_ciphertext: encryptToken('access', env), sync_cursor: 'fresh' };
  const admin = syncAdmin(connection);
  global.fetch = jest.fn(async url => ({ ok: true, json: async () => url.endsWith('/accounts/get')
    ? { accounts: [{ account_id: 'a1', name: 'Card', type: 'credit', balances: { iso_currency_code: 'USD' } }] }
    : { added: [{ transaction_id: 't1', account_id: 'a1', amount: 20, date: '2026-09-20', name: 'Merchant', iso_currency_code: 'USD' }], next_cursor: 'done', has_more: false } }));
  await syncConnection(admin, { ...connection, sync_cursor: 'stale' });
  expect(JSON.parse(global.fetch.mock.calls[1][1].body).cursor).toBe('fresh');
  expect(admin.rpc).toHaveBeenCalledTimes(1);
  expect(admin.rpc.mock.calls[0][1]).toMatchObject({ p_cursor: 'done', p_changes: [expect.objectContaining({ amount_cents: 2000 })] });
  expect(admin.rpc.mock.calls[0][1].p_changes[0]).not.toHaveProperty('status');
});

test('an existing sync lease prevents a second worker from calling the provider', async () => {
  const admin = syncAdmin(null); global.fetch = jest.fn();
  await expect(syncConnection(admin, { id: 'c1', status: 'active', access_token_ciphertext: 'opaque' })).resolves.toEqual({ skipped: true });
  expect(global.fetch).not.toHaveBeenCalled(); expect(admin.rpc).not.toHaveBeenCalled();
});
