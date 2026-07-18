/* webstore-checkout.js exports.handler — the Netlify entrypoint itself.
 *
 * Every other webstoreCheckout* test drives the exported action functions
 * (placeOrder/finalize/priceCart/...) directly with a fake supabase client.
 * None of them exercise `handler` — the method gate, JSON parse, action
 * dispatch, or the outer try/catch that turns a thrown error into a 500
 * instead of an unhandled rejection. These tests close that gap using the
 * same @supabase/supabase-js mock pattern as teamshopAchCheckout.test.js.
 */
process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const { createClient } = require('@supabase/supabase-js');
const { handler } = require('../../netlify/functions/webstore-checkout');

const post = (body) => ({ httpMethod: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body || {}) });

describe('webstore-checkout handler', () => {
  beforeEach(() => {
    // A harmless default client — only reached by tests that get past JSON
    // parsing and action dispatch to an actual DB call.
    createClient.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) });
  });

  test('non-POST → 405', async () => {
    const res = await handler({ httpMethod: 'GET' });
    expect(res.statusCode).toBe(405);
  });

  test('malformed JSON body → 400', async () => {
    const res = await handler(post('{not json'));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid json/i);
  });

  test('unknown action → 400', async () => {
    const res = await handler(post({ action: 'do_something_weird' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/unknown action/i);
  });

  test('an action handler throwing is caught and returns 500, not an unhandled rejection', async () => {
    // get_order reaches the DB the moment orderId is present; a client whose
    // .from() throws synchronously simulates a hard failure inside the
    // dispatched action (matches teamshopAchCheckout.test.js's pattern).
    createClient.mockReturnValue({ from: () => { throw new Error('boom — db unreachable'); } });
    const res = await handler(post({ action: 'get_order', orderId: 'ord1' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/boom/);
  });
});
