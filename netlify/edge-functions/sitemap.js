// Dynamic sitemap for the public team stores (nationalteamshop.com/sitemap.xml).
//
// The storefront is a client-rendered SPA, so there is no static list of store
// URLs for crawlers to discover (the /team-stores directory is search-only). This
// edge function queries the anon-readable webstores_public view for open, publicly
// listed stores and emits a sitemap of their canonical /shop/<slug> URLs on
// nationalteamshop.com.
//
// The open/listed filter mirrors exactly what the directory uses
// (src/storefront/TeamStores.js: status='open' AND public_listed=true). Login-
// gated stores are dropped since their content isn't public. Advertised only from
// nationalteamshop.com/robots.txt (see robots.js); URLs are absolute + canonical
// regardless of which host serves this, so it's safe on previews too.

const SUPABASE_URL =
  Netlify.env.get('REACT_APP_SUPABASE_URL') || Netlify.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Netlify.env.get('REACT_APP_SUPABASE_ANON_KEY') || '';

const SITE_ORIGIN = 'https://nationalteamshop.com';

const xmlEscape = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const urlEntry = (loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`;

async function openStores() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const qs = new URLSearchParams({
    select: 'slug,require_login',
    status: 'eq.open',
    public_listed: 'eq.true',
    order: 'slug.asc',
    limit: '5000',
  });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webstores_public?${qs}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export default async function handler() {
  const stores = await openStores();
  // Always include the directory itself; append each open, public, non-gated store.
  const locs = [`${SITE_ORIGIN}/team-stores`];
  for (const s of stores) {
    if (!s || !s.slug || s.require_login === true) continue;
    locs.push(`${SITE_ORIGIN}/shop/${encodeURIComponent(s.slug)}`);
  }

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
