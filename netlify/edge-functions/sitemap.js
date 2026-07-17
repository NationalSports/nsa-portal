// Dynamic sitemap for nationalteamshop.com (/sitemap.xml).
//
// nationalteamshop.com is the retail Team Shop (a client-rendered SPA), plus the
// still-live club storefronts. Crawlers have no static URL list to discover, so
// this edge function builds one from anon-readable data:
//   • Team Shop — the landing, catalog + per-category views, /stores, /faq,
//     /decoration, and every catalog product at /product/<sku> (enumerated via the
//     anon-granted search_products RPC, filtered to the launch categories the
//     storefront actually shows — mirrors src/teamshop/categories.js).
//   • Club stores — /team-stores + each open, public /shop/<slug> (webstores_public).
// URLs are absolute + canonical regardless of which host serves this (advertised
// only from nationalteamshop.com/robots.txt), so it's safe on previews too.

// `Netlify` is a Deno-edge-only global — reading it at module load throws
// ReferenceError under Jest (or any non-edge runtime), failing the whole
// import. Read lazily instead: env() is only called from ensureEnv(), which
// the handler calls on first use, never at module top level.
const env = (k) => (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : (globalThis.process?.env?.[k] ?? ''));
let SUPABASE_URL = '';
let SUPABASE_ANON_KEY = '';
let _envLoaded = false;
function ensureEnv() {
  if (_envLoaded) return;
  _envLoaded = true;
  SUPABASE_URL = env('REACT_APP_SUPABASE_URL') || env('SUPABASE_URL') || '';
  SUPABASE_ANON_KEY = env('REACT_APP_SUPABASE_ANON_KEY') || '';
}

const SITE_ORIGIN = 'https://nationalteamshop.com';

// Launch categories the Team Shop catalog actually renders. Keys drive the
// /catalog?category=<key> URLs; the dbValues are how products.category is matched
// (incl. the alternate spellings the client folds in). Mirrors categories.js —
// kept inline because edge functions can't import the CJS src module.
// HAND-SYNCED COPY of LAUNCH_CATEGORIES in src/teamshop/categories.js — keep in step (see also og-teamshop.js)
const CATEGORY_KEYS = ['quarter_zips', 'hoodies', 'polos', 'outerwear', 'hats', 'tees', 'bags', 'shorts', 'footwear'];
const LAUNCH_DBVALUES = new Set(['1/4 Zips', 'Hoods', 'Hood', 'Polos', 'Outerwear', 'Hats', 'Beanies', 'Tees', 'Bags', 'Shorts', 'Footwear']);

const xmlEscape = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const urlEntry = (loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`;

const anonHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  Accept: 'application/json',
});

// Team Shop static/content routes (no per-row fetch needed).
function teamShopStaticLocs() {
  const locs = [
    `${SITE_ORIGIN}/`,
    `${SITE_ORIGIN}/catalog`,
    `${SITE_ORIGIN}/stores`,
    `${SITE_ORIGIN}/faq`,
    `${SITE_ORIGIN}/decoration`,
  ];
  for (const k of CATEGORY_KEYS) locs.push(`${SITE_ORIGIN}/catalog?category=${encodeURIComponent(k)}`);
  return locs;
}

// Every catalog product URL (/product/<sku>) via the anon search_products RPC,
// paged and filtered to the launch categories. Rows are per-colorway, so each
// colorway sku is its own product URL — matching the /product/<sku> routing.
async function teamShopProductLocs() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const skus = new Set();
  const pageSize = 1000;
  const MAX = 20000; // hard backstop
  try {
    for (let offset = 0; offset < MAX; offset += pageSize) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_products`, {
        method: 'POST',
        headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_query: null,
          p_category: null,
          p_vendor_id: null,
          p_color_category: null,
          p_in_stock: false,
          p_limit: pageSize,
          p_offset: offset,
        }),
      });
      if (!res.ok) break;
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const r of rows) {
        if (r && r.sku && LAUNCH_DBVALUES.has(String(r.category || '').trim())) skus.add(r.sku);
      }
      if (rows.length < pageSize) break;
    }
  } catch {
    /* fail soft — return whatever we gathered */
  }
  return [...skus].map((sku) => `${SITE_ORIGIN}/product/${encodeURIComponent(sku)}`);
}

// Club storefronts still served on this host: the directory + each open, public store.
async function clubStoreLocs() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [`${SITE_ORIGIN}/team-stores`];
  const qs = new URLSearchParams({
    select: 'slug,require_login',
    status: 'eq.open',
    public_listed: 'eq.true',
    order: 'slug.asc',
    limit: '5000',
  });
  const locs = [`${SITE_ORIGIN}/team-stores`];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webstores_public?${qs}`, { headers: anonHeaders() });
    if (res.ok) {
      const rows = await res.json();
      for (const s of Array.isArray(rows) ? rows : []) {
        if (s && s.slug && s.require_login !== true) locs.push(`${SITE_ORIGIN}/shop/${encodeURIComponent(s.slug)}`);
      }
    }
  } catch {
    /* fail soft */
  }
  return locs;
}

export default async function handler() {
  ensureEnv();
  const [products, clubStores] = await Promise.all([teamShopProductLocs(), clubStoreLocs()]);
  const locs = [...teamShopStaticLocs(), ...products, ...clubStores];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    locs.map(urlEntry).join('\n') +
    `\n</urlset>\n`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

export const config = { path: '/sitemap.xml' };
