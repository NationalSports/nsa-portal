// SEO for the public Team Stores directory (/team-stores).
//
// The directory (src/storefront/TeamStores.js) is a client-rendered SPA and,
// worse for SEO, it's search-only — it renders NO store list until a visitor
// types a name. So there is no crawlable page anywhere that links to individual
// stores, and stores get no internal link equity or non-sitemap discovery path.
//
// This edge function runs on /team-stores and rewrites the served HTML before it
// reaches a crawler: SEO <head> (title, description, canonical → the canonical
// nationalteamshop.com domain, lifecycle robots, OG) plus a real HTML list of
// every open, publicly-listed store — each a crawlable <a href="/shop/<slug>"> —
// rendered INTO #root. React's createRoot clears + replaces those children on
// mount, so this is a no-JS fallback (same HTML for bots and humans), not
// hydration. Mirrors the directory's own open/listed filter (status='open' AND
// public_listed=true). Fail-safe: any problem falls back to the head-only or
// unmodified response.

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
const CANONICAL_HOSTS = new Set(['nationalteamshop.com', 'www.nationalteamshop.com']);
const DEFAULT_IMAGE = 'https://nsa-portal.netlify.app/NEW%20NSA%20Logo%20on%20white.png';

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

async function fetchOpenStores() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const qs = new URLSearchParams({
    select: 'slug,name,logo_url,primary_color',
    status: 'eq.open',
    public_listed: 'eq.true',
    order: 'name.asc',
    limit: '1000',
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

function injectHead(html, tags, title) {
  let out = html;
  out = out.replace(
    /\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description|robots)"[^>]*>/g,
    ''
  );
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  return out.replace(/<\/title>/, `</title>\n${tags}`);
}

function injectBody(html, bodyHtml) {
  if (!html.includes('<div id="root"></div>')) return html;
  return html.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
}

function renderDirectory(stores) {
  const cards = stores
    .filter((s) => s && s.slug && s.name)
    .map((s) => {
      const href = `/shop/${encodeURIComponent(s.slug)}`;
      const primary = /^#[0-9a-fA-F]{3,8}$/.test(s.primary_color || '') ? s.primary_color : '#16223F';
      const logo = s.logo_url
        ? `<img class="tsseo-logo" src="${escapeHtml(s.logo_url)}" alt="${escapeHtml(s.name)} logo" loading="lazy" width="72" height="72" />`
        : `<span class="tsseo-logo tsseo-noimg" aria-hidden="true"></span>`;
      return (
        `<li class="tsseo-item"><a class="tsseo-link" href="${escapeHtml(href)}" style="--tsseo-primary:${escapeHtml(primary)}">` +
        logo +
        `<span class="tsseo-name">${escapeHtml(s.name)}</span>` +
        `</a></li>`
      );
    })
    .join('');

  const count = stores.length;
  const countLine = count
    ? `<p class="tsseo-sub">${count} open team ${count === 1 ? 'store' : 'stores'} — find yours below.</p>`
    : `<p class="tsseo-sub">Search for your school, club, or organization to find your store.</p>`;

  return `<div id="tsseo">
<style>
  #tsseo{font-family:'Source Sans 3',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#2A2F3E;background:#F7F8FB;min-height:100vh}
  #tsseo .tsseo-wrap{max-width:1180px;margin:0 auto;padding:40px 20px 72px}
  #tsseo .tsseo-head{text-align:center;margin:0 0 28px}
  #tsseo h1{font-family:'Barlow Condensed','Arial Narrow',Impact,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(32px,6vw,60px);line-height:1;margin:0 0 12px;color:#16223F}
  #tsseo .tsseo-sub{font-size:16px;color:#5A6075;margin:0}
  #tsseo .tsseo-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
  #tsseo .tsseo-item{margin:0}
  #tsseo .tsseo-link{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit;background:#fff;border:1px solid #E7DFD0;border-left:4px solid var(--tsseo-primary);border-radius:10px;padding:14px 16px;height:100%}
  #tsseo .tsseo-logo{flex:0 0 auto;width:56px;height:56px;object-fit:contain;background:#F2ECE0;border-radius:8px}
  #tsseo .tsseo-noimg{background:#EEF1F6}
  #tsseo .tsseo-name{font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:19px;line-height:1.1}
  @media (max-width:600px){#tsseo .tsseo-grid{grid-template-columns:1fr}}
</style>
<div class="tsseo-wrap">
  <header class="tsseo-head">
    <h1>Find Your Team Store</h1>
    ${countLine}
  </header>
  ${stores.length ? `<ul class="tsseo-grid">${cards}</ul>` : ''}
</div>
</div>`;
}

export default async function handler(request, context) {
  ensureEnv();
  const url = new URL(request.url);

  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const isCanonicalHost = CANONICAL_HOSTS.has(url.hostname.toLowerCase());
  const pageUrl = `${SITE_ORIGIN}/team-stores`;
  const title = 'Team Stores — Find Your School or Club Store | National Sports Apparel';
  const description =
    'Find and shop your school or club\'s official online team store — custom uniforms, spirit wear, and gear from National Sports Apparel, decorated and delivered.';
  const robots = isCanonicalHost ? 'index, follow, max-image-preview:large' : 'noindex, follow';

  const tags = [
    `  <meta name="description" content="${escapeHtml(description)}" />`,
    `  <link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    `  <meta name="robots" content="${robots}" />`,
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:site_name" content="National Sports Apparel" />`,
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(description)}" />`,
    `  <meta property="og:image" content="${escapeHtml(DEFAULT_IMAGE)}" />`,
    `  <meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `  <meta name="twitter:image" content="${escapeHtml(DEFAULT_IMAGE)}" />`,
  ].join('\n');

  let html = await response.text();
  html = injectHead(html, tags, title);

  // Only render the crawlable store list on the canonical host (the netlify.app
  // duplicate stays noindex, so it doesn't need the list).
  if (isCanonicalHost) {
    const stores = await fetchOpenStores();
    html = injectBody(html, renderDirectory(stores));
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, { status: response.status, headers });
}

export const config = { path: '/team-stores' };
