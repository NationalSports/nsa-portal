jest.mock('../../netlify/functions/_shared', () => ({ verifyUserOrInternal: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../netlify/functions/_allSchoolVendorGuard', () => ({ guardAllSchoolVendorRequest: jest.fn() }));
const { verifyUserOrInternal } = require('../../netlify/functions/_shared');
const { guardAllSchoolVendorRequest } = require('../../netlify/functions/_allSchoolVendorGuard');
const ss = require('../../netlify/functions/ss-proxy').handler;
const sanmar = require('../../netlify/functions/sanmar-proxy').handler;
const token = '00000000-0000-4000-8000-000000000001';
const savedEnv = Object.fromEntries(['SS_ACCOUNT_NUMBER', 'SS_API_KEY', 'SANMAR_USERNAME', 'SANMAR_PASSWORD'].map(key => [key, process.env[key]]));
const oldFetch = global.fetch;
const oldTimeout = AbortSignal.timeout;
beforeEach(() => {
  jest.clearAllMocks();
  verifyUserOrInternal.mockResolvedValue({ ok: true });
  process.env.SS_ACCOUNT_NUMBER = 'test'; process.env.SS_API_KEY = 'test';
  process.env.SANMAR_USERNAME = 'test'; process.env.SANMAR_PASSWORD = 'test';
  AbortSignal.timeout = () => undefined;
  guardAllSchoolVendorRequest.mockResolvedValue({ ok: true });
  global.fetch = jest.fn(async () => ({ status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify([{ orderNumber: 'supplier-1' }]) }));
});
afterAll(() => {
  global.fetch = oldFetch; AbortSignal.timeout = oldTimeout;
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const ssEvent = () => ({ httpMethod: 'POST', queryStringParameters: { path: '/orders' }, headers: {}, body: JSON.stringify({ poNumber: 'NSA 1234', testOrder: false, _allSchoolSubmissionToken: token, lines: [{ identifier: 'B123', qty: 1 }] }) });
const smEvent = () => ({ httpMethod: 'POST', queryStringParameters: { service: 'po', action: 'sendPO', env: 'prod' }, headers: {}, body: JSON.stringify({ _allSchoolSubmissionToken: token, PO: { orderNumber: 'NSA 1234', lineItems: [{ partId: '123', quantity: 1, unitPrice: 5, lineNumber: 1 }] } }) });
test.each([{ handler: ss, event: ssEvent }, { handler: sanmar, event: smEvent }])('both live proxies block an invalid/replayed claim before external I/O', async ({ handler, event }) => {
  guardAllSchoolVendorRequest.mockResolvedValue({ ok: false, statusCode: 409, error: 'already started' });
  expect((await handler(event())).statusCode).toBe(409);
  expect(global.fetch).not.toHaveBeenCalled();
});
test('S&S validates then removes the server claim from the supplier JSON', async () => {
  expect((await ss(ssEvent())).statusCode).toBe(200);
  expect(guardAllSchoolVendorRequest).toHaveBeenCalledWith({ vendor: 'S&S Activewear', poNumber: 'NSA 1234', token });
  const supplierBody = JSON.parse(global.fetch.mock.calls[0][1].body);
  expect(supplierBody._allSchoolSubmissionToken).toBeUndefined();
  expect(supplierBody.lines).toEqual([{ identifier: 'B123', qty: 1 }]);
});
test('read-only S&S calls do not consume purchase claims', async () => {
  await ss({ httpMethod: 'GET', queryStringParameters: { path: '/Styles' }, headers: {} });
  expect(guardAllSchoolVendorRequest).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
