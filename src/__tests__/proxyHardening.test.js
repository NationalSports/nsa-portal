// Hardening tests for the vendor/relay proxy functions (netlify/functions/*-proxy.js
// plus image-proxy.js). Same pattern as sheetFetch.test.js: drive the REAL handler
// with a mocked global.fetch and assert on the URL actually requested, so the
// security property is checked against production code, not a reimplementation.
//
// verifyUser/verifyUserOrInternal are mocked (like vendorDigitizing.test.js) so the
// gating decision is controllable without a real Supabase round-trip — we assert the
// handler actually calls the gate and rejects before touching fetch when it says no.

const path = require('path');

let mockVerifyResult = { ok: true, userId: 'u1', teamMemberId: 'tm1', role: 'staff' };
jest.mock('../../netlify/functions/_shared', () => ({
  verifyUser: jest.fn(async () => mockVerifyResult),
  verifyUserOrInternal: jest.fn(async () => mockVerifyResult),
}));

afterEach(() => {
  delete global.fetch;
  mockVerifyResult = { ok: true, userId: 'u1', teamMemberId: 'tm1', role: 'staff' };
  jest.resetModules();
});

const load = (file) => require(path.join(__dirname, '..', '..', 'netlify', 'functions', file));

// ─────────────────────────────── image-proxy.js ───────────────────────────────
// SAFE-allowlisted: caller supplies a full URL, but only a fixed set of supplier /
// CDN hostnames may ever be fetched, and redirects off-allowlist are refused.
describe('image-proxy (SAFE-allowlisted)', () => {
  const { handler } = require('../../netlify/functions/image-proxy');

  test('allowed supplier host is fetched as-is', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('img'),
    }));
    const res = await handler({ queryStringParameters: { url: 'https://cdnm.sanmar.com/foo.jpg' } });
    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://cdnm.sanmar.com/foo.jpg');
  });

  test('attacker-supplied host is refused and never fetched (no open proxy)', async () => {
    global.fetch = jest.fn();
    const res = await handler({ queryStringParameters: { url: 'https://attacker.test/steal.jpg' } });
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('lookalike host (allowlisted domain as a suffix trick) is refused', async () => {
    global.fetch = jest.fn();
    const res = await handler({ queryStringParameters: { url: 'https://cdnm.sanmar.com.attacker.test/x.jpg' } });
    expect(res.statusCode).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an allowlisted host redirecting off-allowlist is blocked, not followed', async () => {
    global.fetch = jest.fn(async () => ({ status: 302, headers: { get: (h) => (h === 'location' ? 'https://attacker.test/x' : null) } }));
    const res = await handler({ queryStringParameters: { url: 'https://cdnm.sanmar.com/foo.jpg' } });
    expect(res.statusCode).toBe(403);
  });

  test('missing url returns 400 and nothing is fetched', async () => {
    global.fetch = jest.fn();
    const res = await handler({ queryStringParameters: null });
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── brevo-proxy.js ───────────────────────────────
// SAFE-allowlisted (the fetched host is hardcoded to api.brevo.com; the caller
// cannot steer it) + GATED (staff-only — carries the company Brevo key).
describe('brevo-proxy (SAFE-allowlisted, GATED)', () => {
  test('anonymous caller is rejected before any fetch (no anonymous relay of the API key)', async () => {
    mockVerifyResult = { ok: false, status: 401, error: 'Missing bearer token' };
    process.env.BREVO_API_KEY = 'brevo-secret-key';
    const { handler } = load('brevo-proxy.js');
    global.fetch = jest.fn();
    const res = await handler({ httpMethod: 'POST', queryStringParameters: null, body: '{}' });
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('authenticated send only ever fetches api.brevo.com, and the key is a request header, never in the response body', async () => {
    process.env.BREVO_API_KEY = 'brevo-secret-key';
    const { handler } = load('brevo-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, text: async () => JSON.stringify({ messageId: 'abc' }) }));
    const res = await handler({ httpMethod: 'POST', queryStringParameters: null, body: JSON.stringify({ to: [{ email: 'a@b.com' }] }) });
    expect(res.statusCode).toBe(200);
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('api.brevo.com');
    expect(res.body).not.toContain('brevo-secret-key');
  });

  test('stats lookup is also pinned to api.brevo.com regardless of query params', async () => {
    process.env.BREVO_API_KEY = 'brevo-secret-key';
    const { handler } = load('brevo-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, text: async () => '[]' }));
    await handler({ httpMethod: 'GET', queryStringParameters: { endpoint: 'stats', messageId: 'm1' } });
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('api.brevo.com');
  });
});

// ─────────────────────────────── omg-proxy.js ───────────────────────────────
// GATED-but-permissive: `path` is caller-supplied and concatenated onto a fixed,
// env-controlled base URL (never a caller-supplied host) — string concatenation
// after a scheme+host prefix can't hand a caller a new authority, so this isn't an
// open proxy, but the path itself isn't validated. Pinning current behavior.
describe('omg-proxy (GATED-but-permissive)', () => {
  test('anonymous caller is rejected before any fetch (no anonymous relay of the OMG token)', async () => {
    mockVerifyResult = { ok: false, status: 401, error: 'Missing bearer token' };
    process.env.OMG_API_KEY = 'omg-secret-token';
    const { handler } = load('omg-proxy.js');
    global.fetch = jest.fn();
    const res = await handler({ queryStringParameters: null });
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('fetched host always stays on the configured OMG base (path cannot repoint the host)', async () => {
    process.env.OMG_API_KEY = 'omg-secret-token';
    delete process.env.OMG_API_BASE_URL;
    const { handler } = load('omg-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }));
    // FIXME: `path` reaches fetch() unvalidated (no allowlist of sub-paths, no
    // rejection of "//host" tricks). It is currently safe only because it is
    // concatenated after a fixed scheme+host prefix, so it can't change the
    // authority — pin that property here rather than changing behavior, since
    // choosing which OMG sub-paths are legitimate is a business decision.
    await handler({ queryStringParameters: { path: '//evil.test/x' } });
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('app.ordermygear.com');
  });

  test('OMG API key is sent as a header, never echoed into the response body', async () => {
    process.env.OMG_API_KEY = 'omg-secret-token';
    const { handler } = load('omg-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ ok: true }) }));
    const res = await handler({ queryStringParameters: null });
    expect(res.body).not.toContain('omg-secret-token');
  });
});

// ───────────────────────────── omg-report-proxy.js ─────────────────────────────
// SAFE-allowlisted: anonymous, but the host is a fixed literal and the only
// caller input (report id) is regex-validated to a UUID shape before it ever
// reaches the URL, so it cannot smuggle a path/host change.
describe('omg-report-proxy (SAFE-allowlisted)', () => {
  const { handler } = require('../../netlify/functions/omg-report-proxy');
  const VALID = '48ff450f-30dc-46c0-5101-698fe5464e53';

  test('valid id fetches only report.ordermygear.com', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, text: async () => '{}' }));
    const res = await handler({ queryStringParameters: { id: VALID } });
    expect(res.statusCode).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toBe(`https://report.ordermygear.com/reports/${VALID}`);
  });

  test('id crafted to smuggle a path/host change is rejected before fetch', async () => {
    global.fetch = jest.fn();
    for (const bad of ['../../../etc/passwd', 'x/../../evil', 'a"; DROP TABLE', 'evil.test/reports/x']) {
      const res = await handler({ queryStringParameters: { id: bad } });
      expect(res.statusCode).toBe(400);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('missing id returns 400 and nothing is fetched', async () => {
    global.fetch = jest.fn();
    const res = await handler({ queryStringParameters: null });
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── momentec-proxy.js ───────────────────────────────
// SAFE-allowlisted: every branch picks its host from a fixed map/constant
// (V2_HOSTS.stage / V2_HOSTS.prod / BASE_URL) — the caller only ever selects a KEY
// into that map, never a raw host. Order + order-details are GATED (they carry
// dealer credentials); style/catalog reads are intentionally public (no secrets).
describe('momentec-proxy (SAFE-allowlisted)', () => {
  test('unknown env value is rejected before any fetch (cannot pick an arbitrary host)', async () => {
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn();
    const res = await handler({
      queryStringParameters: { service: 'order', env: 'https://attacker.test' },
      body: JSON.stringify({ items: [{ sku: 'x' }], poNum: 'PO1' }),
    });
    expect(res.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('anonymous caller cannot place an order (no anonymous relay of dealer credentials)', async () => {
    mockVerifyResult = { ok: false, status: 401, error: 'Missing bearer token' };
    process.env.MOMENTEC_LOGON_ID = 'dealer1';
    process.env.MOMENTEC_PASSWORD = 'super-secret-pw';
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn();
    const res = await handler({
      queryStringParameters: { service: 'order', env: 'stage' },
      body: JSON.stringify({ items: [{ sku: 'x' }], poNum: 'PO1' }),
    });
    expect(res.statusCode).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('authenticated order submission fetches only the stage host, and dealer credentials never appear in the response', async () => {
    process.env.MOMENTEC_LOGON_ID = 'dealer1';
    process.env.MOMENTEC_PASSWORD = 'super-secret-pw';
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => JSON.stringify({ orderId: 'ORD1' }) }));
    const res = await handler({
      queryStringParameters: { service: 'order', env: 'stage' },
      body: JSON.stringify({ items: [{ sku: 'x' }], poNum: 'PO1' }),
    });
    expect(res.statusCode).toBe(200);
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('stage-api.momentecbrands.com');
    expect(res.body).not.toContain('super-secret-pw');
    expect(res.body).not.toContain('dealer1');
  });

  test('a failed order submission does not leak the injected dealer password back to the client', async () => {
    // FIXME (pinned, not fixed): on failure we return `raw: text.slice(0,800)`
    // from Momentec's own response. We inject payload.credentials into the
    // REQUEST; if Momentec's API ever echoed the submitted body back in an
    // error response, that raw passthrough would leak it. We don't control or
    // have visibility into Momentec's error-echo behavior, so redacting would
    // be guessing at their API shape — pin today's contract (our code never
    // constructs a response containing the password itself) instead of
    // speculatively rewriting response handling.
    process.env.MOMENTEC_LOGON_ID = 'dealer1';
    process.env.MOMENTEC_PASSWORD = 'super-secret-pw';
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn(async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ message: 'bad SKU' }) }));
    const res = await handler({
      queryStringParameters: { service: 'order', env: 'stage' },
      body: JSON.stringify({ items: [{ sku: 'x' }], poNum: 'PO1' }),
    });
    expect(res.body).not.toContain('super-secret-pw');
  });

  test('public style/catalog lookup needs no auth and stays on the prod v2 host', async () => {
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, text: async () => '{}' }));
    const res = await handler({ queryStringParameters: { service: 'style', design: 'PC61' } });
    expect(res.statusCode).toBe(200);
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('api.momentecbrands.com');
  });

  test('default catalog path stays on the fixed BASE_URL host regardless of the path query param', async () => {
    const { handler } = load('momentec-proxy.js');
    global.fetch = jest.fn(async () => ({ status: 200, headers: { get: () => null }, text: async () => '{}' }));
    await handler({ queryStringParameters: { path: '//evil.test/x' } });
    expect(new URL(global.fetch.mock.calls[0][0]).hostname).toBe('www.momentecbrands.com');
  });
});
