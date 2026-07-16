/* src/teamshop/useTeamShopRoute.js — the library-free URL + browser-history
 * router for the Team Shop storefront (mirrors src/storefront/Storefront.js's
 * pattern: useState(parseRoute()) seeded at mount, one popstate listener as
 * the only route-state writer, navTo -> buildUrl -> pushState/replaceState +
 * a synthetic popstate).
 *
 * This file covers the pure, DOM-free surface (teamShopBase/parseRoute/
 * buildUrl take an injectable `loc`/`base`, per the routing plan's §6 test
 * list): base selection, the full §2 URL scheme table's parse<->build round
 * trip on BOTH the alias ('') and preview ('/teamshop') bases, base-strip
 * edge cases, encoding, and the soft-404/unknown-subsegment fallbacks.
 * Guard-effect and derived-`inOrderShell` behavior (which need a mounted
 * TeamShopApp) live in teamshopRouteGuards.test.js. */
const {
  teamShopBase, parseRoute, buildUrl,
} = require('../teamshop/useTeamShopRoute');

const loc = (hostname, pathname, search = '') => ({ hostname, pathname, search });

describe('teamShopBase', () => {
  test.each([
    ['nationalteamshop.com', ''],
    ['www.nationalteamshop.com', ''],
    ['NationalTeamShop.com', ''], // case-insensitive, same as isTeamShopHost
    ['nationalteamshop.com.', ''], // trailing FQDN dot
    ['nationalteamshop.com:443', ''], // stray port
  ])('alias host %s -> base %j', (hostname, expected) => {
    expect(teamShopBase(loc(hostname, '/'))).toBe(expected);
  });

  test.each([
    ['deploy-preview-123--nsa.netlify.app', '/teamshop'],
    ['localhost', '/teamshop'],
    ['nsa-portal.netlify.app', '/teamshop'],
  ])('any other host %s -> base %j (deploy previews / e2e)', (hostname, expected) => {
    expect(teamShopBase(loc(hostname, '/'))).toBe(expected);
  });
});

// ── §2 URL scheme table: parse<->build round trip, both bases ──────────────
// [routeName, params, path-without-base] — buildUrl(name, params, base) must
// equal `base + path`, and parseRoute of that same URL must reproduce the
// route (name + params) exactly.
const TABLE = [
  ['landing', {}, ''],
  ['catalog', {}, '/catalog'],
  ['catalog', { category: 'hoodies' }, '/catalog?category=hoodies'],
  ['product', { sku: 'ABC123' }, '/product/ABC123'],
  ['stores', {}, '/stores'],
  ['decoration', {}, '/decoration'],
  ['decoration', { method: 'embroidery' }, '/decoration'], // embroidery is the default — never in the path
  ['decoration', { method: 'dtf' }, '/decoration/dtf'],
  ['decoration', { method: 'heat' }, '/decoration/heat'],
  ['account', {}, '/account'],
  ['account', { section: 'logos' }, '/account/logos'],
  ['account', { section: 'orders' }, '/account/orders'],
  ['search', {}, '/search'],
  ['search', { q: 'jersey' }, '/search?q=jersey'],
  ['search', { q: 'jersey', category: 'polos' }, '/search?q=jersey&category=polos'],
  ['order', {}, '/order'], // bare
  ['order', { orderView: 'start' }, '/order'], // 'start' never appears in the path
  ['order', { orderView: 'catalog' }, '/order/catalog'],
  ['order', { orderView: 'logos' }, '/order/logos'],
  ['order', { orderView: 'placement' }, '/order/placement'],
  ['order', { orderView: 'checkout' }, '/order/checkout'],
  ['order', { orderView: 'confirmed' }, '/order/confirmed'],
  ['cart', {}, '/cart'],
  ['faq', {}, '/faq'],
];

describe.each([
  ['alias', '', 'nationalteamshop.com'],
  ['preview', '/teamshop', 'deploy-preview.netlify.app'],
])('parseRoute <-> buildUrl round trip (%s base)', (_label, base, hostname) => {
  test.each(TABLE)('%s %j -> %s', (name, params, path) => {
    const built = buildUrl(name, params, base);
    expect(built).toBe(base + path || '/');

    const [pathname, search = ''] = built.slice(base.length).split('?');
    const parsed = parseRoute(loc(hostname, base + pathname, search ? `?${search}` : ''), base);
    expect(parsed.name).toBe(name);
    // Compare only the params buildUrl actually consumed for this row (not
    // every key on the parsed route — e.g. 'landing' carries no params at all).
    Object.keys(params).forEach((k) => {
      if (k === 'orderView' && params[k] === 'start') {
        expect(parsed.orderView).toBe('start'); // bare /order still round-trips to 'start'
      } else {
        expect(parsed[k]).toBe(params[k]);
      }
    });
  });
});

describe('buildUrl — never emits a stray order sub-path', () => {
  test("cart is always '/cart', never '/order/cart'", () => {
    expect(buildUrl('cart', {}, '')).toBe('/cart');
    expect(buildUrl('cart', {}, '/teamshop')).toBe('/teamshop/cart');
  });
  test("bare order (orderView 'start') never appears as '/order/start'", () => {
    expect(buildUrl('order', { orderView: 'start' }, '')).toBe('/order');
  });
});

describe('base strip', () => {
  test('/teamshop/product/ABC (preview) parses identically to /product/ABC (alias)', () => {
    const preview = parseRoute(loc('deploy-preview.netlify.app', '/teamshop/product/ABC'), '/teamshop');
    const alias = parseRoute(loc('nationalteamshop.com', '/product/ABC'), '');
    expect(preview).toEqual(alias);
    expect(preview).toEqual({ name: 'product', sku: 'ABC' });
  });

  test('/teamshop (preview, no trailing segment) parses the same as / (alias) — landing', () => {
    expect(parseRoute(loc('deploy-preview.netlify.app', '/teamshop'), '/teamshop')).toEqual({ name: 'landing' });
    expect(parseRoute(loc('deploy-preview.netlify.app', '/teamshop/'), '/teamshop')).toEqual({ name: 'landing' });
    expect(parseRoute(loc('nationalteamshop.com', '/'), '')).toEqual({ name: 'landing' });
  });

  test('a SKU literally "teamshop" strips only the leading base segment once', () => {
    const parsed = parseRoute(loc('deploy-preview.netlify.app', '/teamshop/product/teamshop'), '/teamshop');
    expect(parsed).toEqual({ name: 'product', sku: 'teamshop' });
  });
});

describe('encoding', () => {
  test('a search query with spaces/&/% round-trips', () => {
    const q = 'polo & red 50%';
    const url = buildUrl('search', { q }, '');
    const parsed = parseRoute(loc('nationalteamshop.com', url.split('?')[0], `?${url.split('?')[1]}`), '');
    expect(parsed.q).toBe(q);
  });

  test('a SKU with URL-special characters round-trips', () => {
    const sku = 'AB/CD#1 2';
    const url = buildUrl('product', { sku }, '');
    const parsed = parseRoute(loc('nationalteamshop.com', url), '');
    expect(parsed.sku).toBe(sku);
  });
});

describe('unknown-segment fallbacks', () => {
  test('an unrecognized top-level segment soft-404s to landing', () => {
    expect(parseRoute(loc('nationalteamshop.com', '/totally-not-a-route'), '')).toEqual({ name: 'landing' });
  });

  test('an unknown order sub-view falls back to "start" (StartWithLogo, not a crash)', () => {
    expect(parseRoute(loc('nationalteamshop.com', '/order/not-a-real-step'), '')).toEqual({ name: 'order', orderView: 'start' });
  });

  test('an unknown decoration method falls back to "embroidery"', () => {
    expect(parseRoute(loc('nationalteamshop.com', '/decoration/not-a-method'), '')).toEqual({ name: 'decoration', method: 'embroidery' });
  });

  test('an unknown account section falls back to null (the shell, no scroll target)', () => {
    expect(parseRoute(loc('nationalteamshop.com', '/account/not-a-section'), '')).toEqual({ name: 'account', section: null });
  });
});

describe('reserved top-level segments never collide with a Team Shop route name', () => {
  // index.js dispatches these BEFORE the Team-Shop-host branch (see
  // src/lib/hostRouting.js) — buildUrl must never emit any of them, and
  // parseRoute must never claim to own them (segment-exact, so this hook
  // never even sees them on a real request — this just documents the set).
  const RESERVED = ['shop', 'adidas', 'livelook', 'team-stores', 'auth', 'onboarding', 'teamshop-queue', 'floor-station', 'vendor-digitizing', 'teamshop'];
  const EMITTED_NAMES = ['landing', 'catalog', 'product', 'stores', 'decoration', 'account', 'search', 'order', 'cart', 'faq'];
  test('none of buildUrl\'s route names collide with a reserved segment', () => {
    EMITTED_NAMES.forEach((n) => expect(RESERVED).not.toContain(n));
  });
});
