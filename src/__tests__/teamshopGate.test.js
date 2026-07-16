// Tests for the Team Shop launch gate edge function.
// The gate uses crypto.subtle (native in the Deno edge runtime); provide Node's webcrypto
// under Jest if the test env didn't already expose a global `crypto`.
const { webcrypto } = require('crypto');
const { TextEncoder, TextDecoder } = require('util');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;
if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;

import handler, {
  isGatedHost, isExcludedPath, safeEqual, readCookie, gateHtml,
} from '../../netlify/edge-functions/teamshop-gate';

const KEY = 'NSA123abc';

function setKey(v) {
  global.Netlify = { env: { get: (k) => (k === 'TEAMSHOP_GATE_KEY' ? v : '') } };
}
function req(url, cookie) {
  return { url, headers: { get: (h) => (String(h).toLowerCase() === 'cookie' ? (cookie ?? null) : null) } };
}
const ctx = { next: async () => new Response('SPA', { headers: { 'content-type': 'text/html' } }) };

async function sha256Hex(s) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

afterEach(() => { delete global.Netlify; });

describe('pure helpers', () => {
  test('isGatedHost matches only the Team Shop apex + www, case-insensitively', () => {
    expect(isGatedHost('nationalteamshop.com')).toBe(true);
    expect(isGatedHost('WWW.NationalTeamShop.com')).toBe(true);
    expect(isGatedHost('nsa-portal.netlify.app')).toBe(false);
    expect(isGatedHost('evilnationalteamshop.com')).toBe(false);
    expect(isGatedHost('nationalteamshop.com.evil.com')).toBe(false);
    expect(isGatedHost('')).toBe(false);
  });

  test('isExcludedPath covers robots/sitemap, netlify internals, and static assets', () => {
    for (const p of ['/robots.txt', '/sitemap.xml', '/.netlify/functions/x', '/static/app.css', '/a/b/logo.png', '/main.abc123.js']) {
      expect(isExcludedPath(p)).toBe(true);
    }
    for (const p of ['/', '/catalog', '/product/ABC', '/shop/some-store', '/teamshop']) {
      expect(isExcludedPath(p)).toBe(false);
    }
  });

  test('safeEqual is true only for identical strings, false on any diff/length/type', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('abc', null)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
  });

  test('readCookie extracts a named cookie from a Cookie header', () => {
    expect(readCookie('a=1; nts_gate=deadbeef; z=9', 'nts_gate')).toBe('deadbeef');
    expect(readCookie('nts_gate=xyz', 'nts_gate')).toBe('xyz');
    expect(readCookie('other=1', 'nts_gate')).toBe('');
    expect(readCookie('', 'nts_gate')).toBe('');
    expect(readCookie(null, 'nts_gate')).toBe('');
  });

  test('gateHtml is noindex and shows the retry note only when asked', () => {
    expect(gateHtml(false)).toContain('name="robots" content="noindex, nofollow"');
    expect(gateHtml(false)).toContain('Opening soon');
    expect(gateHtml(false)).not.toContain("didn't fit");
    expect(gateHtml(true)).toContain("didn't fit");
  });
});

describe('handler — disabled / out of scope', () => {
  test('no TEAMSHOP_GATE_KEY set -> passes through (undefined)', async () => {
    setKey('');
    expect(await handler(req('https://nationalteamshop.com/'), ctx)).toBeUndefined();
  });

  test('key set but non-Team-Shop host -> passes through', async () => {
    setKey(KEY);
    expect(await handler(req('https://nsa-portal.netlify.app/'), ctx)).toBeUndefined();
    expect(await handler(req('https://www.nationalsportsapparel.com/'), ctx)).toBeUndefined();
  });

  test('excluded paths pass through even with no cookie', async () => {
    setKey(KEY);
    for (const p of ['/robots.txt', '/sitemap.xml', '/.netlify/functions/webstore-checkout', '/static/x.css']) {
      expect(await handler(req(`https://nationalteamshop.com${p}`), ctx)).toBeUndefined();
    }
  });
});

describe('handler — gating', () => {
  test('gated host, no cookie -> 200 gate page, noindex + no-store', async () => {
    setKey(KEY);
    const out = await handler(req('https://nationalteamshop.com/catalog'), ctx);
    expect(out.status).toBe(200);
    expect(out.headers.get('x-robots-tag')).toMatch(/noindex/);
    expect(out.headers.get('cache-control')).toMatch(/no-store/);
    expect(await out.text()).toContain('Opening soon');
  });

  test('correct ?key= -> 302, strips key from Location, sets unlock cookie', async () => {
    setKey(KEY);
    const out = await handler(req(`https://nationalteamshop.com/catalog?category=tees&key=${KEY}`), ctx);
    expect(out.status).toBe(302);
    expect(out.headers.get('location')).toBe('/catalog?category=tees');
    const sc = out.headers.get('set-cookie');
    expect(sc).toContain('nts_gate=');
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('Max-Age=');
    // cookie value is sha256(key), never the raw key
    expect(sc).toContain(await sha256Hex(KEY));
    expect(sc).not.toContain(KEY);
  });

  test('wrong ?key= -> 200 gate page with retry note', async () => {
    setKey(KEY);
    const out = await handler(req('https://nationalteamshop.com/?key=nope'), ctx);
    expect(out.status).toBe(200);
    expect(await out.text()).toContain("didn't fit");
  });

  test('valid unlock cookie -> passes through', async () => {
    setKey(KEY);
    const cookie = `nts_gate=${await sha256Hex(KEY)}`;
    expect(await handler(req('https://nationalteamshop.com/catalog', cookie), ctx)).toBeUndefined();
  });

  test('wrong cookie -> gate page', async () => {
    setKey(KEY);
    const out = await handler(req('https://nationalteamshop.com/', 'nts_gate=forged'), ctx);
    expect(out.status).toBe(200);
    expect(await out.text()).toContain('Opening soon');
  });

  test('never throws on a malformed URL', async () => {
    setKey(KEY);
    await expect(handler(req('::://not a url'), ctx)).resolves.toBeUndefined();
  });
});
