jest.mock('../../netlify/functions/_shared', () => ({ verifyQBOUser: jest.fn(), getSupabaseAdmin: jest.fn() }));
jest.mock('../../netlify/functions/_qb', () => ({ getValidAccessToken: jest.fn(), qbRequest: jest.fn() }));
jest.mock('../../netlify/functions/_qboServerReview', () => ({ runReview: jest.fn(), reviewStore: jest.fn() }));
const { verifyQBOUser, getSupabaseAdmin } = require('../../netlify/functions/_shared');
const { getValidAccessToken, qbRequest } = require('../../netlify/functions/_qb');
const { runReview } = require('../../netlify/functions/_qboServerReview');
const { handler } = require('../../netlify/functions/qbo-review-background');
const original = { ...process.env };
beforeEach(() => {
  jest.resetAllMocks();
  process.env.CONTEXT = 'production';
  process.env.QBO_SERVER_REVIEW_ENABLED = 'true';
  process.env.QBO_REVIEW_REALM_ID = '123';
  verifyQBOUser.mockResolvedValue({ ok: true, userId: 'staff' });
  getValidAccessToken.mockResolvedValue({ realm_id: '123', access_token: 'private-token' });
  qbRequest.mockResolvedValue({ status: 200, data: { QueryResponse: { Invoice: [] } } });
  runReview.mockImplementation(async opts => { await opts.queryInvoices(['900']); return { id: 'run', status: 'complete' }; });
});
afterAll(() => { process.env = original; });
test('unauthorized request never reaches storage or QBO', async () => {
  verifyQBOUser.mockResolvedValue({ ok: false, status: 403 });
  expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(403);
  expect(getSupabaseAdmin).not.toHaveBeenCalled();
  expect(runReview).not.toHaveBeenCalled();
});
test.each(['deploy-preview','branch-deploy','dev'])('refuses %s even when flag is on', async context => {
  process.env.CONTEXT = context;
  expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(409);
  expect(runReview).not.toHaveBeenCalled();
});
test('disabled by default', async () => {
  delete process.env.QBO_SERVER_REVIEW_ENABLED;
  expect((await handler({ httpMethod: 'POST' })).statusCode).toBe(409);
});
test('non-POST requests do not authenticate or execute', async () => {
  expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(405);
  expect(verifyQBOUser).not.toHaveBeenCalled();
});
test('caller cannot select a write, realm, sandbox or query', async () => {
  const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ action: 'upsert_payment', realm: 'evil', sandbox: true, query: 'evil' }) });
  expect(result.statusCode).toBe(200);
  expect(qbRequest.mock.calls[0]).toEqual(['GET', expect.stringContaining('/v3/company/123/query?'), 'private-token', null, false]);
  expect(result.body).not.toContain('private-token');
});
test('realm changes block the QBO read', async () => {
  getValidAccessToken.mockResolvedValue({ realm_id: '456', access_token: 'private-token' });
  await expect(handler({ httpMethod: 'POST' })).rejects.toThrow('realm_changed');
  expect(qbRequest).not.toHaveBeenCalled();
});
test.each([{ status: 429 }, { status: 200, data: { Fault: {} } }, { status: 200, data: {} }])('bad read response fails closed', async response => {
  qbRequest.mockResolvedValue(response);
  await expect(handler({ httpMethod: 'POST' })).rejects.toThrow('qbo_read_failed');
});
