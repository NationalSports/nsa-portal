/** @jest-environment node */
/* Team store link previews: the drawn headline card (_storeOgImage), the
 * store-preview function (meta + image modes), and og-storefront's use of it.
 * Background: since the 2026-09-02 view lockdown the edge function's direct
 * view reads 401'd, so every texted store link previewed as the NSA logo.
 *
 * sharp's native binary doesn't load under Jest (functionSmoke mocks it too),
 * so it's stubbed here; the drawing itself is checked by rendering real
 * images outside Jest. */

jest.mock('sharp', () => {
  const make = () => {
    const api = new Proxy({}, {
      get: (_t, key) => {
        if (key === 'then') return undefined;
        if (key === 'toBuffer') {
          return async (opts) => (opts && opts.resolveWithObject
            ? { data: Buffer.from('PNG'), info: { width: 300, height: 360 } }
            : Buffer.from('JPEG'));
        }
        return () => api;
      },
    });
    return api;
  };
  // A plain function, not jest.fn: CRA's resetMocks would wipe a mock implementation.
  return () => make();
});

const mockStoreRow = {
  id: 'store-1',
  slug: 'sjm-girls-hoops',
  name: 'San Joaquin Memorial Girls Basketball Team Store',
  status: 'open',
  close_at: '2026-10-26T06:59:00Z',
  require_login: false,
  public_listed: true,
  hero_blurb: null,
  logo_url: '',
  banner_url: null,
  primary_color: '#0C2340',
  accent_color: '#E4002B',
  customer_id: 'c-123',
};
let mockRows = [mockStoreRow];

jest.mock('../../netlify/functions/_shared', () => ({
  getSupabaseAdmin: () => {
    const chain = {
      _table: null,
      from(t) { chain._table = t; return chain; },
      select() { return chain; },
      eq() { return chain; },
      limit() {
        if (chain._table === 'webstores') return Promise.resolve({ data: mockRows, error: null });
        return Promise.resolve({ data: [], error: null }); // customers
      },
    };
    return chain;
  },
}));

const { renderStoreOgImage, mascotWord, closeLabel, normalizeText } = require('../../netlify/functions/_storeOgImage');
const { handler } = require('../../netlify/functions/store-preview');

describe('_storeOgImage', () => {
  test('mascot/sport word and Pacific close date', () => {
    expect(mascotWord('San Joaquin Memorial Girls Basketball Team Store')).toBe('BASKETBALL');
    expect(mascotWord('Cal Poly Mustangs 2026')).toBe('MUSTANGS');
    // 06:59 UTC on the 26th is 11:59 PM PT on the 25th.
    expect(closeLabel('2026-10-26T06:59:00Z')).toBe('Sun, Oct 25');
    expect(normalizeText('Españoleta  Élan <b>')).toBe('ESPANOLETA ELAN B');
  });

  test('renders with a logo, without one, and with bad colors', async () => {
    await expect(renderStoreOgImage(mockStoreRow, Buffer.from('logo'))).resolves.toEqual(Buffer.from('JPEG'));
    await expect(renderStoreOgImage(mockStoreRow, null)).resolves.toEqual(Buffer.from('JPEG'));
    await expect(renderStoreOgImage({ name: 'X', primary_color: 'navy', accent_color: null, status: 'closed' }, null))
      .resolves.toEqual(Buffer.from('JPEG'));
  });
});

describe('store-preview function', () => {
  beforeEach(() => { mockRows = [mockStoreRow]; });

  test('meta returns public fields and a versioned image path, never customer_id', async () => {
    const res = await handler({ queryStringParameters: { slug: 'sjm-girls-hoops', format: 'meta' } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.store.name).toBe(mockStoreRow.name);
    expect(body.store).not.toHaveProperty('customer_id');
    expect(body.image_path).toMatch(/^\/\.netlify\/functions\/store-preview\?slug=sjm-girls-hoops&v=[0-9a-f]{12}$/);
  });

  test('image version changes when a drawn field changes', async () => {
    const v = async () => JSON.parse((await handler({ queryStringParameters: { slug: 'sjm-girls-hoops', format: 'meta' } })).body).image_path;
    const a = await v();
    mockRows = [{ ...mockStoreRow, close_at: '2026-11-02T07:59:00Z' }];
    expect(await v()).not.toBe(a);
  });

  test('unknown or archived store → 404 meta, image redirects to the NSA logo', async () => {
    mockRows = [{ ...mockStoreRow, status: 'archived' }];
    expect((await handler({ queryStringParameters: { slug: 'sjm-girls-hoops', format: 'meta' } })).statusCode).toBe(404);
    const img = await handler({ queryStringParameters: { slug: 'sjm-girls-hoops' } });
    expect(img.statusCode).toBe(302);
    expect(img.headers.Location).toMatch(/NSA%20Logo/);
  });

  test('rejects malformed slugs', async () => {
    expect((await handler({ queryStringParameters: { slug: '../etc', format: 'meta' } })).statusCode).toBe(400);
    expect((await handler({ queryStringParameters: { slug: '' } })).statusCode).toBe(302);
  });

  test('image mode returns a JPEG', async () => {
    const res = await handler({ queryStringParameters: { slug: 'sjm-girls-hoops', v: 'x' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/jpeg');
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body, 'base64').toString()).toBe('JPEG');
  });
});

describe('og-storefront uses store-preview', () => {
  // Jest's node environment here has no fetch-era globals; same minimal fakes as ogTeamshop.test.js.
  class FakeHeaders {
    constructor(init) {
      this.map = new Map(init instanceof FakeHeaders ? init.map : Object.entries(init || {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
    }
    get(k) { return this.map.has(k.toLowerCase()) ? this.map.get(k.toLowerCase()) : null; }
    set(k, v) { this.map.set(k.toLowerCase(), String(v)); }
    delete(k) { this.map.delete(k.toLowerCase()); }
  }
  class FakeResponse {
    constructor(body, init = {}) {
      this.body = body;
      this.status = init.status || 200;
      this.headers = init.headers instanceof FakeHeaders ? init.headers : new FakeHeaders(init.headers);
    }
    async text() { return this.body; }
  }
  const jsonReply = (obj) => ({ ok: true, status: 200, json: async () => obj });
  const HTML = '<html><head><title>National Sports Connect</title>'
    + '<meta property="og:title" content="National Sports Apparel" />'
    + '<meta property="og:image" content="https://nsa-portal.netlify.app/NEW%20NSA%20Logo%20on%20white.png" />'
    + '</head><body><div id="root"></div></body></html>';
  const ctx = () => ({
    next: async () => new FakeResponse(HTML, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  });
  const req = (url) => ({ url });
  let edge;
  beforeAll(async () => {
    global.Headers = FakeHeaders;
    global.Response = FakeResponse;
    edge = (await import('../../netlify/edge-functions/og-storefront')).default;
  });
  afterEach(() => { delete global.fetch; });

  test('connect link gets the store name and the drawn headline image', async () => {
    const seen = [];
    global.fetch = async (u) => {
      seen.push(String(u));
      return jsonReply({ store: mockStoreRow, image_path: '/.netlify/functions/store-preview?slug=sjm-girls-hoops&v=abc' });
    };
    const res = await edge(req('https://connect.nationalsportsapparel.com/shop/sjm-girls-hoops'), ctx());
    const html = await res.text();
    expect(seen).toEqual(['https://connect.nationalsportsapparel.com/.netlify/functions/store-preview?format=meta&slug=sjm-girls-hoops']);
    expect(html).toContain('<meta property="og:title" content="San Joaquin Memorial Girls Basketball Team Store" />');
    expect(html).toContain('<meta property="og:image" content="https://connect.nationalsportsapparel.com/.netlify/functions/store-preview?slug=sjm-girls-hoops&amp;v=abc" />');
    expect(html).toContain('<meta property="og:url" content="https://connect.nationalsportsapparel.com/shop/sjm-girls-hoops" />');
    expect(html).toContain('Store closes October 25, 2026');
    expect(html).not.toContain('NEW%20NSA%20Logo');
  });

  test('lookup failure keeps the default preview (fail open)', async () => {
    global.fetch = async () => { throw new Error('down'); };
    const res = await edge(req('https://connect.nationalsportsapparel.com/shop/sjm-girls-hoops'), ctx());
    const html = await res.text();
    expect(html).toContain('og:title" content="National Sports Apparel"');
    expect(html).toContain('noindex');
  });
});
