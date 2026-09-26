jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn(() => ({})), safeEqualStr: (a, b) => typeof a === 'string' && a === b }));
jest.mock('../../netlify/functions/_emailRouter', () => ({ sendPortalEmail: jest.fn() }));
const { sendPortalEmail } = require('../../netlify/functions/_emailRouter');
const { getSupabaseAdmin } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/scheduled-email-send');
beforeEach(() => { getSupabaseAdmin.mockReturnValue({}); process.env.INTERNAL_FUNCTION_SECRET = 'internal-test-secret'; sendPortalEmail.mockResolvedValue({ status: 200, messageId: 'gmail:123' }); });
afterEach(() => { delete process.env.INTERNAL_FUNCTION_SECRET; });
test('unauthenticated scheduler calls never send mail', async () => {
  expect((await handler({ httpMethod: 'POST', headers: {}, body: '{}' })).statusCode).toBe(401);
  expect(sendPortalEmail).not.toHaveBeenCalled();
});
test('authenticated scheduler calls use the same router as immediate sends', async () => {
  const body = { to: [{ email: 'coach@example.com' }], subject: 'Invoice' };
  const response = await handler({ httpMethod: 'POST', headers: { 'x-internal-secret': 'internal-test-secret' }, body: JSON.stringify(body) });
  expect(JSON.parse(response.body)).toMatchObject({ messageId: 'gmail:123' });
  expect(sendPortalEmail).toHaveBeenCalledWith({}, body);
});
