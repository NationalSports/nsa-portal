/* Exhaustive unit tests for src/lib/hostRouting.js — the pure predicate
 * src/index.js uses to send nationalteamshop.com visitors (and /teamshop paths
 * on any host) to the Team Shop chunk instead of the portal login. */

const { isTeamShopHost, isFloorStationPath, isVendorDigitizingPath, isProductionHQPath } = require('../lib/hostRouting');

describe('isTeamShopHost', () => {
  // ── Hostname matches (any path) ────────────────────────────────────────────
  test.each([
    ['nationalteamshop.com', '/'],
    ['nationalteamshop.com', ''],
    ['nationalteamshop.com', '/anything/else'],
    ['www.nationalteamshop.com', '/'],
    ['www.nationalteamshop.com', '/checkout'],
  ])('true for team-shop host %s with path %s', (host, path) => {
    expect(isTeamShopHost(host, path)).toBe(true);
  });

  test('hostname matching is case-insensitive', () => {
    expect(isTeamShopHost('NationalTeamShop.com', '/')).toBe(true);
    expect(isTeamShopHost('WWW.NATIONALTEAMSHOP.COM', '/')).toBe(true);
  });

  test('tolerates a trailing FQDN dot', () => {
    expect(isTeamShopHost('nationalteamshop.com.', '/')).toBe(true);
    expect(isTeamShopHost('www.nationalteamshop.com.', '/')).toBe(true);
  });

  test('tolerates a stray :port on the hostname', () => {
    expect(isTeamShopHost('nationalteamshop.com:443', '/')).toBe(true);
    expect(isTeamShopHost('www.nationalteamshop.com:8888', '/')).toBe(true);
  });

  // ── Hostname NON-matches ───────────────────────────────────────────────────
  test.each([
    'nsa-portal.netlify.app',
    'nationalsportsapparel.com',
    'www.nationalsportsapparel.com',
    'localhost',
    '127.0.0.1',
    // Lookalikes / suffix attacks must NOT match:
    'evilnationalteamshop.com',
    'nationalteamshop.com.evil.com',
    'shop.nationalteamshop.com', // only apex + www are aliased
    'nationalteamshop.net',
    'nationalteamshop',
  ])('false for non-team-shop host %s at /', (host) => {
    expect(isTeamShopHost(host, '/')).toBe(false);
  });

  // ── /teamshop path on any host ─────────────────────────────────────────────
  test.each([
    ['localhost', '/teamshop'],
    ['nsa-portal.netlify.app', '/teamshop'],
    ['deploy-preview-123--nsa-portal.netlify.app', '/teamshop/'],
    ['nationalsportsapparel.com', '/teamshop/cart'],
    ['localhost', '/teamshop/products/123'],
  ])('true for host %s with path %s', (host, path) => {
    expect(isTeamShopHost(host, path)).toBe(true);
  });

  // ── Path NON-matches ───────────────────────────────────────────────────────
  test.each([
    '/',
    '',
    '/shop/some-store', // club storefront, not team shop
    '/team-stores',
    '/adidas',
    '/teamshopping', // prefix-only lookalike segment
    '/teamshop2',
    '/x/teamshop', // not at the path root
    '/TEAMSHOP', // paths are case-sensitive, like all index.js path checks
    '/TeamShop/',
  ])('false for portal host with path %s', (path) => {
    expect(isTeamShopHost('nsa-portal.netlify.app', path)).toBe(false);
  });

  // ── Degenerate inputs never throw and never match ──────────────────────────
  test.each([
    [null, null],
    [undefined, undefined],
    ['', ''],
    [null, '/'],
    ['nsa-portal.netlify.app', null],
  ])('safe on degenerate input (%s, %s)', (host, path) => {
    expect(isTeamShopHost(host, path)).toBe(false);
  });

  test('team-shop hostname still wins with degenerate path', () => {
    expect(isTeamShopHost('nationalteamshop.com', null)).toBe(true);
    expect(isTeamShopHost('nationalteamshop.com', undefined)).toBe(true);
  });
});

// The index.js routing branch for the shop-floor scan station chunk — exact
// path match with optional trailing slash, same shape as isTeamShopQueue.
describe('isFloorStationPath', () => {
  test.each(['/floor-station', '/floor-station/'])('true for %s', (path) => {
    expect(isFloorStationPath(path)).toBe(true);
  });
  test.each([
    '/', '', '/floor-station/extra', '/floor-stations', '/x/floor-station',
    '/FLOOR-STATION', // case-sensitive like every index.js path check
    null, undefined,
  ])('false for %s', (path) => {
    expect(isFloorStationPath(path)).toBe(false);
  });
});

// The index.js routing branch for the Top Star digitizing vendor portal chunk —
// exact path match with optional trailing slash, same shape as isFloorStationPath.
describe('isVendorDigitizingPath', () => {
  test.each(['/vendor-digitizing', '/vendor-digitizing/'])('true for %s', (path) => {
    expect(isVendorDigitizingPath(path)).toBe(true);
  });
  test.each([
    '/', '', '/vendor-digitizing/extra', '/vendor-digitizings', '/x/vendor-digitizing',
    '/VENDOR-DIGITIZING', // case-sensitive like every index.js path check
    null, undefined,
  ])('false for %s', (path) => {
    expect(isVendorDigitizingPath(path)).toBe(false);
  });
});

// Production HQ's additive /production alias (the canonical route,
// /teamshop-queue, is a plain string check directly in index.js and unaffected).
describe('isProductionHQPath', () => {
  test.each(['/production', '/production/'])('true for %s', (path) => {
    expect(isProductionHQPath(path)).toBe(true);
  });
  test.each([
    '/', '', '/production/extra', '/productions', '/x/production',
    '/PRODUCTION', // case-sensitive like every index.js path check
    null, undefined,
  ])('false for %s', (path) => {
    expect(isProductionHQPath(path)).toBe(false);
  });
});
