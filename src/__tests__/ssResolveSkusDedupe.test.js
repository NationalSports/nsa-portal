// Unit tests for ssResolveSkus's lookup budget and failure reporting.
//
// Real failure this locks in (batch PO 57402 SFGO, SO-2036 — 32 lines, 15 style codes):
// every line came back "no matched S&S SKU", and the rep read that as "S&S doesn't carry
// these". It wasn't true — bill_sku_aliases shows the same styles resolving from S&S's own
// /Products data hours earlier (A231 ×8 between 07-31 and 08-13; AT203-50/-70/-09 the same
// morning). What actually happened is that our synced skus carry the colorway ("A231-00",
// "-09", "-50", "-70" are four style codes for ONE S&S style), so the resolver fired the
// same /Styles+/Products pair once per colorway, blew through S&S's 60-requests-per-minute
// cap, and reported every throttled lookup as "no match".
//
// Two guarantees here: (1) one lookup per distinct SEARCH CODE, so colorways of a style
// cost one lookup between them; (2) a lookup that ERRORED is reported as failedStyles, never
// silently folded into "unmatched".

jest.mock('../utils', () => ({ authFetch: jest.fn() }));
jest.mock('../components', () => ({ calcSOStatus: () => ({}), resolveOrderShipTo: () => ({}) }));
jest.mock('../richardsonPrices', () => ({ getRichardsonLevel4Price: () => 0 }));

const { authFetch } = require('../utils');
const { ssResolveSkus } = require('../vendorApis');

// S&S catalogs the polo as style "A231" with one product row per color+size.
const A231_PRODUCTS = [
  { sku: 'B231F8003', colorName: 'White', sizeName: 'S' },
  { sku: 'B231F8093', colorName: 'Grey Three', sizeName: 'S' },
  { sku: 'B231F8503', colorName: 'Black', sizeName: 'S' },
  { sku: 'B231F8703', colorName: 'Collegiate Red', sizeName: 'S' },
];

const ok = (body) => Promise.resolve({
  ok: true, status: 200,
  json: () => Promise.resolve(body),
  text: () => Promise.resolve(JSON.stringify(body)),
});
const fail = (status) => Promise.resolve({
  ok: false, status,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(`{"message":"error ${status}"}`),
});

// Decode the S&S path out of the proxy URL the code builds.
const pathOf = (url) => decodeURIComponent(String(url).split('path=')[1] || '');

// The four colorways of one polo, as buildSSOrderLines emits them.
const FOUR_COLORWAYS = [
  { key: 'A231-00|White|S', style: 'A231-00', color: 'White', size: 'S' },
  { key: 'A231-09|Grey Three|S', style: 'A231-09', color: 'Grey Three', size: 'S' },
  { key: 'A231-50|Black|S', style: 'A231-50', color: 'Black', size: 'S' },
  { key: 'A231-70|Collegiate Red|S', style: 'A231-70', color: 'Collegiate Red', size: 'S' },
];

beforeEach(() => { jest.clearAllMocks(); });

describe('ssResolveSkus — one lookup per distinct search code', () => {
  test('four colorways of A231 resolve from a SINGLE style lookup', async () => {
    const calls = [];
    authFetch.mockImplementation((url) => {
      const p = pathOf(url);
      calls.push(p);
      if (p.startsWith('/Styles?search=')) return ok([{ styleID: 771, partNumber: 'A231', styleName: 'A231', brandName: 'adidas' }]);
      if (p.startsWith('/Products/?style=')) return ok(A231_PRODUCTS);
      return ok([]);
    });

    const { resolved, failedStyles } = await ssResolveSkus(FOUR_COLORWAYS);

    // Every line matched its own colorway — no cross-color bleed.
    expect(resolved['A231-00|White|S']).toBe('B231F8003');
    expect(resolved['A231-09|Grey Three|S']).toBe('B231F8093');
    expect(resolved['A231-50|Black|S']).toBe('B231F8503');
    expect(resolved['A231-70|Collegiate Red|S']).toBe('B231F8703');
    expect(failedStyles).toEqual([]);

    // The budget claim: ONE /Styles + ONE /Products for all four colorways. Pre-fix this
    // was four of each, and that multiplication is what tripped the rate limit.
    const styleCalls = calls.filter((p) => p.startsWith('/Styles?search='));
    const productCalls = calls.filter((p) => p.startsWith('/Products/?style='));
    expect(styleCalls).toEqual(['/Styles?search=A231']);
    expect(productCalls).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  test('two genuinely different styles still get their own lookups', async () => {
    authFetch.mockImplementation((url) => {
      const p = pathOf(url);
      if (p === '/Styles?search=A231') return ok([{ styleID: 771, partNumber: 'A231' }]);
      if (p === '/Styles?search=AT101') return ok([{ styleID: 902, partNumber: 'AT101' }]);
      if (p.startsWith('/Products/?style=771')) return ok(A231_PRODUCTS);
      if (p.startsWith('/Products/?style=902')) return ok([{ sku: 'B027F8503', colorName: 'Black/ White', sizeName: 'S' }]);
      return ok([]);
    });

    const { resolved } = await ssResolveSkus([
      ...FOUR_COLORWAYS,
      { key: 'AT101-50|Black/ White|S', style: 'AT101-50', color: 'Black/ White', size: 'S' },
    ]);
    expect(resolved['A231-70|Collegiate Red|S']).toBe('B231F8703');
    expect(resolved['AT101-50|Black/ White|S']).toBe('B027F8503');
    const searched = authFetch.mock.calls.map((c) => pathOf(c[0])).filter((p) => p.startsWith('/Styles?search='));
    expect(new Set(searched)).toEqual(new Set(['/Styles?search=A231', '/Styles?search=AT101']));
  });
});

describe('ssResolveSkus — a failed lookup is reported, not silently "unmatched"', () => {
  test('an errored style lands in failedStyles with its message', async () => {
    // 500 is not retryable, so this returns immediately.
    authFetch.mockImplementation(() => fail(500));

    const { resolved, failedStyles, lookupError } = await ssResolveSkus(FOUR_COLORWAYS);

    expect(Object.keys(resolved)).toHaveLength(0);
    // All four colorways are flagged as "never answered", NOT as "S&S has no such item".
    expect(failedStyles.sort()).toEqual(['A231-00', 'A231-09', 'A231-50', 'A231-70']);
    expect(lookupError).toMatch(/500/);
  });

  test('a style that errors on one variant but matches on another is NOT a failure', async () => {
    // The base-style search errors; the as-is code answers. The line resolves, so the rep
    // must not be shown a scary "S&S never answered" banner.
    authFetch.mockImplementation((url) => {
      const p = pathOf(url);
      if (p === '/Styles?search=A231') return fail(500);
      if (p === '/Styles?search=A231-70') return ok([{ styleID: 771, partNumber: 'A231-70' }]);
      if (p.startsWith('/Products/?style=')) return ok(A231_PRODUCTS);
      return ok([]);
    });

    const { resolved, failedStyles } = await ssResolveSkus([FOUR_COLORWAYS[3]]);
    expect(resolved['A231-70|Collegiate Red|S']).toBe('B231F8703');
    expect(failedStyles).toEqual([]);
  });

  test('a 429 throttle is retried and recovers instead of reading as "no match"', async () => {
    let styleHits = 0;
    authFetch.mockImplementation((url) => {
      const p = pathOf(url);
      if (p.startsWith('/Styles?search=')) {
        styleHits += 1;
        return styleHits === 1 ? fail(429) : ok([{ styleID: 771, partNumber: 'A231' }]);
      }
      if (p.startsWith('/Products/?style=')) return ok(A231_PRODUCTS);
      return ok([]);
    });

    const { resolved, failedStyles } = await ssResolveSkus([FOUR_COLORWAYS[3]]);
    expect(styleHits).toBe(2);                    // retried once
    expect(resolved['A231-70|Collegiate Red|S']).toBe('B231F8703');
    expect(failedStyles).toEqual([]);
  }, 15000);

  test('a throttled account stops calling after 2 consecutive failures', async () => {
    // Without the breaker every remaining style would burn its own 1s+2s+4s backoff — minutes
    // of spinner on a 15-style batch that is going to fail regardless.
    authFetch.mockImplementation(() => fail(500));
    const many = ['A231-70', 'A1005-50', 'AH607-50', 'A400-50', 'AT101-50', 'AT203-50', 'AT104-50']
      .map((style) => ({ key: style + '|Black|S', style, color: 'Black', size: 'S' }));

    const { failedStyles } = await ssResolveSkus(many);

    // Every style is still reported as unanswered — the rep sees the full list...
    expect(failedStyles.sort()).toEqual([...many.map((d) => d.style)].sort());
    // ...but we stopped hitting the API after the breaker tripped, rather than one lookup per style.
    expect(authFetch.mock.calls.length).toBeLessThanOrEqual(3);
  });

  test('a POST is never replayed by the retry (orders must not double-submit)', async () => {
    const { ssApiCall } = require('../vendorApis');
    authFetch.mockImplementation(() => fail(429));
    await expect(ssApiCall('/orders/', { method: 'POST', body: '{}' })).rejects.toThrow(/429/);
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  test('the two retry paths do not compound (exactly 4 GET attempts, not 3×3)', async () => {
    // The status branch and the thrown-error branch each retry. Without the guard, the inner
    // chain's final throw re-entered the outer frame's catch and retried again, multiplying
    // attempts and stacking backoffs into a multi-minute hang.
    const { ssApiCall } = require('../vendorApis');
    authFetch.mockImplementation(() => fail(429));
    await expect(ssApiCall('/Styles?search=A231')).rejects.toThrow(/429/);
    expect(authFetch).toHaveBeenCalledTimes(4); // initial + 3 retries, full stop
  }, 20000);
});
