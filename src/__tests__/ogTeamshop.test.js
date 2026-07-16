/* Tests for netlify/edge-functions/og-teamshop.js — above all the BAIL path:
 * the edge function is registered on '/*', so it runs on every request to this
 * app, and it must be a pure pass-through (return undefined, never call
 * context.next()) for every hostname except nationalteamshop.com. */

import handler from '../../netlify/edge-functions/og-teamshop';

// Minimal Response/Headers for the rewrite-path tests (jsdom doesn't provide
// the fetch globals the Deno edge runtime has).
class FakeHeaders {
  constructor(init) { this.map = new Map(init instanceof FakeHeaders ? init.map : []); }
  get(k) { return this.map.has(k.toLowerCase()) ? this.map.get(k.toLowerCase()) : null; }
  set(k, v) { this.map.set(k.toLowerCase(), String(v)); }
  delete(k) { this.map.delete(k.toLowerCase()); }
}
class FakeResponse {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders();
  }
  async text() { return this.body; }
}
beforeAll(() => {
  global.Headers = FakeHeaders;
  global.Response = FakeResponse;
});

const HTML = '<html><head><title>National Sports Apparel</title>'
  + '<meta property="og:title" content="NSA" /><meta name="twitter:card" content="summary" />'
  + '</head><body></body></html>';

const htmlContext = () => {
  const headers = new FakeHeaders();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-length', String(HTML.length));
  const next = jest.fn(async () => new FakeResponse(HTML, { status: 200, headers }));
  return { next };
};
// A context whose next() must never be called — proves a TRUE pass-through.
const untouchableContext = () => ({
  next: jest.fn(() => { throw new Error('context.next() must not be called on the bail path'); }),
});

describe('og-teamshop bail path (other hostnames are never affected)', () => {
  test.each([
    'https://nsa-portal.netlify.app/',
    'https://nationalsportsapparel.com/',
    'https://www.nationalsportsapparel.com/index.html',
    'https://nsa-portal.netlify.app/shop/some-store',
    'https://deploy-preview-42--nsa-portal.netlify.app/teamshop', // preview path w/o the domain: SPA handles it, no OG rewrite
    'https://evilnationalteamshop.com/', // suffix lookalike must NOT match
    'https://nationalteamshop.com.evil.com/',
    'http://localhost:8888/',
  ])('returns undefined without calling next() for %s', async (url) => {
    const ctx = untouchableContext();
    await expect(handler({ url }, ctx)).resolves.toBeUndefined();
    expect(ctx.next).not.toHaveBeenCalled();
  });

  test.each([
    'https://nationalteamshop.com/shop/some-store', // club storefront path still owned by og-storefront/SPA
    'https://nationalteamshop.com/static/js/main.abc123.js',
    'https://www.nationalteamshop.com/adidas',
  ])('team-shop host but non-landing path passes through: %s', async (url) => {
    const ctx = untouchableContext();
    await expect(handler({ url }, ctx)).resolves.toBeUndefined();
    expect(ctx.next).not.toHaveBeenCalled();
  });

  test('fails open (undefined) when next() throws on the landing path', async () => {
    const out = await handler({ url: 'https://nationalteamshop.com/' }, untouchableContext());
    expect(out).toBeUndefined();
  });
});

describe('og-teamshop rewrite path (nationalteamshop.com landing)', () => {
  test.each([
    'https://nationalteamshop.com/',
    'https://www.nationalteamshop.com/',
    'https://nationalteamshop.com/index.html',
    'https://www.nationalteamshop.com/teamshop',
    'https://nationalteamshop.com/teamshop/',
  ])('injects static Team Shop OG tags for %s', async (url) => {
    const out = await handler({ url }, htmlContext());
    const body = await out.text();
    expect(body).toContain('<title>National Team Shop — Your logo. Team-quality gear.</title>');
    expect(body).toContain('property="og:title" content="National Team Shop — Your logo. Team-quality gear."');
    expect(body).toContain('property="og:type" content="website"');
    expect(body).toContain('property="og:description"');
    // Default NSA tags were removed, not duplicated.
    expect(body).not.toContain('content="NSA"');
    expect((body.match(/property="og:title"/g) || []).length).toBe(1);
    // Stale content-length dropped since the body changed.
    expect(out.headers.get('content-length')).toBeNull();
    expect(out.status).toBe(200);
  });

  test('non-HTML responses on the landing path pass through unmodified', async () => {
    const headers = new FakeHeaders();
    headers.set('content-type', 'application/json');
    const resp = new FakeResponse('{"ok":true}', { status: 200, headers });
    const ctx = { next: jest.fn(async () => resp) };
    const out = await handler({ url: 'https://nationalteamshop.com/' }, ctx);
    expect(out).toBe(resp);
  });
});
