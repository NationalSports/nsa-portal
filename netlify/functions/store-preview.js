// Link previews for team store links (/shop/<slug> on connect.nationalsportsapparel.com,
// nationalteamshop.com, …). Two GET modes, both keyed only by the store slug:
//
//   ?slug=<slug>&format=meta   → JSON the edge function og-storefront.js needs to
//                                write the page's preview tags (name, blurb,
//                                lifecycle flags, and the preview image URL).
//   ?slug=<slug>&v=<hash>      → the 1200×630 headline image itself (JPEG):
//                                logo in front, sport/mascot word ghosted behind,
//                                team colors — drawn by _storeOgImage.js.
//
// Why a function: since 2026-09-02 the public store views are service-role
// only (supabase/migrations/20260902123000_security_invoker_public_facades.sql),
// so the edge function can no longer read them with the browser key — every
// lookup 401'd and every texted store link previewed as the generic NSA logo.
// This endpoint reads with the service role and returns only fields the public
// storefront already shows.
//
// Only `slug` is trusted input; everything drawn comes from the store row, so
// nobody can make it render arbitrary text or fetch arbitrary URLs. `v` is a
// cache-buster derived from the drawn fields: the CDN can keep each image for
// weeks while a logo/color/name/date change still shows up on the next send.
//
// Fail-safe: any problem makes the image mode redirect to the static NSA logo
// (what previews showed before) and the meta mode return 404/500, which
// og-storefront treats as "keep the default tags".

const crypto = require('crypto');
const { getSupabaseAdmin } = require('./_shared');
const { applyCustomerBranding } = require('./_webstorePublicBranding');
const { renderStoreOgImage } = require('./_storeOgImage');

const DEFAULT_IMAGE = 'https://nsa-portal.netlify.app/NEW%20NSA%20Logo%20on%20white.png';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,159}$/i;
// Where store logos are actually hosted. Anything else is drawn as the crest.
const LOGO_HOSTS = ['res.cloudinary.com', 'assetly.ordermygear.com', 'supabase.co'];
const MAX_LOGO_BYTES = 8 * 1024 * 1024;
// Bump when the drawing changes, so the CDN drops every cached image.
const DESIGN_VERSION = '1';

const STORE_FIELDS = 'id,slug,name,status,close_at,require_login,public_listed,hero_blurb,logo_url,banner_url,primary_color,accent_color,customer_id';

const imageFallback = () => ({
  statusCode: 302,
  headers: { Location: DEFAULT_IMAGE, 'Cache-Control': 'public, max-age=300' },
  body: '',
});
const json = (statusCode, body, cdnSeconds = 0) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(cdnSeconds ? { 'Netlify-CDN-Cache-Control': `public, s-maxage=${cdnSeconds}, stale-while-revalidate=${cdnSeconds}` } : {}),
  },
  body: JSON.stringify(body),
});

async function loadStore(slug) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.from('webstores').select(STORE_FIELDS).eq('slug', slug).limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  if (!row || row.status === 'archived') return null;
  const { customer_id, ...store } = row; // customer_id stays server-side
  await applyCustomerBranding(sb, row, store);
  return store;
}

// Changes whenever anything the image draws changes.
const imageVersion = (s) => crypto.createHash('sha1')
  .update([DESIGN_VERSION, s.name, s.logo_url, s.primary_color, s.accent_color, s.close_at, s.status].map((v) => String(v ?? '')).join('|'))
  .digest('hex')
  .slice(0, 12);

async function fetchLogo(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (!LOGO_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    // redirect: 'manual' — an allowed host must not bounce us somewhere else.
    const res = await fetch(u.toString(), { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'NSA-Portal/1.0' } });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') || 0) > MAX_LOGO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_LOGO_BYTES ? null : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const slug = String(q.slug || '').trim();
  const wantsMeta = q.format === 'meta';

  if (!SLUG_RE.test(slug)) return wantsMeta ? json(400, { error: 'Invalid store slug' }) : imageFallback();

  if (wantsMeta) {
    try {
      const store = await loadStore(slug);
      if (!store) return json(404, { error: 'Store not found' }, 60);
      // Relative: og-storefront picks the origin (production vs deploy preview).
      const imagePath = `/.netlify/functions/store-preview?slug=${encodeURIComponent(store.slug)}&v=${imageVersion(store)}`;
      return json(200, {
        store: {
          id: store.id,
          name: store.name,
          status: store.status,
          close_at: store.close_at,
          require_login: store.require_login,
          public_listed: store.public_listed,
          hero_blurb: store.hero_blurb,
          logo_url: store.logo_url,
          banner_url: store.banner_url,
          primary_color: store.primary_color,
        },
        image_path: imagePath,
        image_width: 1200,
        image_height: 630,
      }, 60);
    } catch (e) {
      console.error('[store-preview meta]', e && e.message);
      return json(500, { error: 'Lookup failed' });
    }
  }

  try {
    const store = await loadStore(slug);
    if (!store) return imageFallback();
    const logo = await fetchLogo(store.logo_url);
    const jpeg = await renderStoreOgImage(store, logo);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
        'Netlify-CDN-Cache-Control': 'public, s-maxage=2592000, stale-while-revalidate=86400',
      },
      body: jpeg.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error('[store-preview image]', e && e.message);
    return imageFallback();
  }
};
