/* WS2 function hardening — guards that must hold BEFORE any network/credential use.
 * These cases all short-circuit before the outbound fetch, so no fetch mock is needed.
 *
 *   image-proxy      : host allowlist + no-redirect SSRF guard (anonymous storefront
 *                      caller, so allowlist — not auth — is the correct gate).
 *   shipstation-webhook : fail-closed shared secret + resource_url host pin (SSRF /
 *                      credential-leak guard).
 */

describe('image-proxy — host allowlist (SSRF gate)', () => {
  const { handler } = require('../../netlify/functions/image-proxy');
  const ev = (url) => ({ httpMethod: 'GET', queryStringParameters: url == null ? {} : { url } });

  test('missing url → 400', async () => {
    expect((await handler(ev(null))).statusCode).toBe(400);
  });
  test('non-allowlisted host → 403 (no fetch)', async () => {
    expect((await handler(ev('https://evil.example.com/x.jpg'))).statusCode).toBe(403);
  });
  test('attacker host that merely CONTAINS an allowed domain → 403', async () => {
    // sanmar.com.evil.com must not pass an endsWith-style check.
    expect((await handler(ev('https://sanmar.com.evil.com/x.jpg'))).statusCode).toBe(403);
  });
  test('malformed url → 400', async () => {
    expect((await handler(ev('not a url'))).statusCode).toBe(400);
  });
});

describe('shipstation-webhook — fail-closed secret + resource_url pin', () => {
  const OLD = process.env;
  const load = () => require('../../netlify/functions/shipstation-webhook');
  beforeEach(() => { jest.resetModules(); process.env = { ...OLD }; });
  afterAll(() => { process.env = OLD; });

  const post = (body, query) => ({ httpMethod: 'POST', body: JSON.stringify(body || {}), queryStringParameters: query || {} });

  test('non-POST → 405', async () => {
    process.env.SHIPSTATION_API_KEY = 'k'; process.env.SHIPSTATION_API_SECRET = 's';
    process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    const { handler } = load();
    expect((await handler({ httpMethod: 'GET' })).statusCode).toBe(405);
  });

  test('missing core creds → 500 not configured', async () => {
    const { handler } = load();
    expect((await handler(post({}))).statusCode).toBe(500);
  });

  test('unset webhook secret → 401 (fail-closed, rejects all)', async () => {
    process.env.SHIPSTATION_API_KEY = 'k'; process.env.SHIPSTATION_API_SECRET = 's';
    process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    delete process.env.SHIPSTATION_WEBHOOK_SECRET;
    const { handler } = load();
    expect((await handler(post({}, { token: 'anything' }))).statusCode).toBe(401);
  });

  test('wrong token → 401', async () => {
    process.env.SHIPSTATION_API_KEY = 'k'; process.env.SHIPSTATION_API_SECRET = 's';
    process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.SHIPSTATION_WEBHOOK_SECRET = 'right';
    const { handler } = load();
    expect((await handler(post({}, { token: 'wrong' })).then((r) => r.statusCode))).toBe(401);
  });

  test('good token but resource_url off ShipStation host → 400 (SSRF/cred-leak block)', async () => {
    process.env.SHIPSTATION_API_KEY = 'k'; process.env.SHIPSTATION_API_SECRET = 's';
    process.env.SUPABASE_URL = 'http://x'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
    process.env.SHIPSTATION_WEBHOOK_SECRET = 'right';
    const { handler } = load();
    const r = await handler(post(
      { resource_type: 'SHIP_NOTIFY', resource_url: 'https://attacker.example.com/steal' },
      { token: 'right' }));
    expect(r.statusCode).toBe(400);
  });
});
