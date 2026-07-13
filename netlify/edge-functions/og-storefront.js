// SEO + rich link previews for public team stores (/shop/<slug>).
//
// The storefront is a client-rendered React SPA (createRoot into an empty
// <div id="root">), so without help every store ships the same static
// index.html: generic <head> tags and no product content. Link-preview bots and
// most search/AI crawlers never run JS, so they'd see a bare shell.
//
// This edge function runs on every /shop/* request. For a real store slug it
// looks the store up in the anon-readable webstores_public view and rewrites the
// served HTML BEFORE it reaches the crawler:
//   • <head> — store-specific <title>, description, canonical (→ the canonical
//     nationalteamshop.com domain), lifecycle-aware robots, and OG/Twitter tags.
//   • <body> — for the indexable store HOME on the canonical host, the store's
//     above-the-fold content (name, blurb, category list, product grid with
//     names/prices/images/links) is rendered INTO #root. React's createRoot
//     clears + replaces those children on mount, so this is a no-JS fallback,
//     not hydration: same HTML for bots and humans (no cloaking), just crawlable.
// Everything is fail-safe — any lookup/markup problem falls back to the
// unmodified (or head-only) response, never a broken page.

const SUPABASE_URL =
  Netlify.env.get('REACT_APP_SUPABASE_URL') || Netlify.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY =
  Netlify.env.get('REACT_APP_SUPABASE_ANON_KEY') || '';

// Canonical store domain. nationalteamshop.com is a Netlify alias of this site
// that serves the storefront SPA directly; it's the one origin we consolidate
// every store URL onto (the marketing /shop/* path 301s here, the raw
// netlify.app origin is de-duped via robots.js). og:url + canonical always point
// here, whichever host actually served the request.
const SITE_ORIGIN = 'https://nationalteamshop.com';
const CANONICAL_HOSTS = new Set(['nationalteamshop.com', 'www.nationalteamshop.com']);
const DEFAULT_IMAGE = 'https://nsa-portal.netlify.app/NEW%20NSA%20Logo%20on%20white.png';
const GRID_LIMIT = 48; // products shown in the crawlable grid

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Reshape a store image into a 1200×630 landscape preview card.
//
// Store logos/banners are usually portrait or square (e.g. a 1034×1163 crest),
// but link-preview cards (iMessage / Slack / Facebook) are wide landscape and
// center-CROP the image to fill — so a tall logo shows only its top sliver.
// All store images live on Cloudinary, which can reshape on the fly: pad the
// whole image, centered, into 1200×630 on a white background (c_pad) so the
// full logo is always visible. Padding on white (not the brand color) keeps
// dark logos legible — a navy crest on a navy fill would disappear. We keep
// the original format (no f_auto) so picky scrapers never get served webp.
// Non-Cloudinary URLs (e.g. the static NSA default) pass through untouched.
const CLOUDINARY_MARKER = '/image/upload/';
const ogImage = (url) => {
  if (!url || !url.includes('res.cloudinary.com')) return url;
  const i = url.indexOf(CLOUDINARY_MARKER);
  if (i === -1) return url;
  const cut = i + CLOUDINARY_MARKER.length;
  return `${url.slice(0, cut)}c_pad,w_1200,h_630,b_white/${url.slice(cut)}`;
};

const priceStr = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? '$' + n.toFixed(2) : '';
};

const closesText = (closeAt) => {
  if (!closeAt) return '';
  const d = new Date(closeAt);
  if (isNaN(d.getTime())) return '';
  return 'Store closes ' + d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// Pull the <slug> out of /shop/<slug>[/...]. Bare /shop or /shop/ has none.
const slugFromPath = (pathname) => {
  const segs = pathname.split('/').filter(Boolean); // ['shop', '<slug>', ...]
  return segs[0] === 'shop' && segs[1] ? decodeURIComponent(segs[1]) : '';
};

async function fetchStore(slug) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const qs = new URLSearchParams({
    slug: `eq.${slug}`,
    select:
      'id,name,logo_url,banner_url,hero_blurb,status,public_listed,require_login,primary_color,close_at',
    limit: '1',
  });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webstores_public?${qs}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const store = Array.isArray(rows) ? rows[0] : null;
    if (!store || store.status === 'archived') return null;
    return store;
  } catch {
    return null;
  }
}

async function fetchProducts(storeId) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !storeId) return [];
  const qs = new URLSearchParams({
    store_id: `eq.${storeId}`,
    select: 'webstore_product_id,name,category,image_front_url,retail_price,kind,sort_order',
    order: 'sort_order.asc',
    limit: '100',
  });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/webstore_storefront_products?${qs}`, {
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

// Replace the existing og/twitter/title tags with store-specific ones. The
// static defaults in index.html are removed first so each property appears once.
function injectTags(html, tags, title) {
  let out = html;
  // Drop the default OG/Twitter/description/robots metas + any canonical + title
  // so we don't emit duplicates.
  out = out.replace(
    /\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description|robots)"[^>]*>/g,
    ''
  );
  out = out.replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  // Insert the fresh tags right after the (now store-specific) <title>.
  return out.replace(/<\/title>/, `</title>\n${tags}`);
}

// For an unknown/archived slug we keep the default NSA preview but add a canonical
// + noindex so the generic app shell isn't indexed as a phantom store page.
function injectNoindex(html, pageUrl) {
  const block = [
    `  <link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    `  <meta name="robots" content="noindex, follow" />`,
  ].join('\n');
  const out = html
    .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '')
    .replace(/\s*<meta\s+name="robots"[^>]*>/gi, '');
  return out.replace(/<\/title>/, `</title>\n${block}`);
}

// Server-rendered, above-the-fold store content — a no-JS fallback placed INSIDE
// #root (React clears + replaces it on mount). Semantic, accurate, on-brand.
function renderStoreBody(store, products, slug) {
  const base = `/shop/${encodeURIComponent(slug)}`;
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(store.primary_color || '') ? store.primary_color : '#16223F';

  // Collapse color/size variants that share a name, cap the grid.
  const seen = new Set();
  const items = [];
  for (const p of products) {
    if (!p || !p.name) continue;
    const key = String(p.name).trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(p);
    if (items.length >= GRID_LIMIT) break;
  }

  const cats = [];
  const catSeen = new Set();
  for (const p of items) {
    const c = (p.category || '').trim();
    if (c && !catSeen.has(c.toLowerCase())) { catSeen.add(c.toLowerCase()); cats.push(c); }
  }

  const cards = items
    .map((p) => {
      const kind = p.kind === 'bundle' ? 'b' : 'p';
      const href = `${base}/${kind}/${encodeURIComponent(p.webstore_product_id)}`;
      const price = priceStr(p.retail_price);
      const img = p.image_front_url
        ? `<img class="sfseo-img" src="${escapeHtml(p.image_front_url)}" alt="${escapeHtml(p.name)}" loading="lazy" width="300" height="300" />`
        : `<span class="sfseo-img sfseo-noimg" aria-hidden="true"></span>`;
      return (
        `<li class="sfseo-item"><a class="sfseo-link" href="${escapeHtml(href)}">` +
        img +
        `<span class="sfseo-name">${escapeHtml(p.name)}</span>` +
        (price ? `<span class="sfseo-price">${price}</span>` : '') +
        `</a></li>`
      );
    })
    .join('');

  const closes = closesText(store.close_at);
  const logo = store.logo_url
    ? `<img class="sfseo-logo" src="${escapeHtml(store.logo_url)}" alt="${escapeHtml(store.name)} logo" width="96" height="96" />`
    : '';
  const blurb = store.hero_blurb ? `<p class="sfseo-blurb">${escapeHtml(store.hero_blurb)}</p>` : '';
  const catNav = cats.length
    ? `<nav class="sfseo-cats" aria-label="Product categories">${cats
        .map((c) => `<span class="sfseo-cat">${escapeHtml(c)}</span>`)
        .join('')}</nav>`
    : '';

  return `<div id="sfseo" style="--sfseo-primary:${escapeHtml(primary)}">
<style>
  #sfseo{font-family:'Source Sans 3',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#2A2F3E;background:#FAF6EF;min-height:100vh}
  #sfseo .sfseo-wrap{max-width:1180px;margin:0 auto;padding:28px 20px 64px}
  #sfseo .sfseo-head{text-align:center;padding:12px 0 8px}
  #sfseo .sfseo-logo{display:inline-block;height:96px;width:auto;object-fit:contain;margin:0 auto 12px}
  #sfseo h1{font-family:'Barlow Condensed','Arial Narrow',Impact,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(30px,5vw,52px);line-height:1.02;margin:0 0 10px;color:var(--sfseo-primary)}
  #sfseo .sfseo-blurb{max-width:640px;margin:0 auto 8px;font-size:17px;line-height:1.5;color:#4A4636}
  #sfseo .sfseo-closes{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8A2B2F;margin:8px 0 0}
  #sfseo .sfseo-cats{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:18px 0 6px}
  #sfseo .sfseo-cat{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6B6256;border:1px solid #E7DFD0;border-radius:999px;padding:5px 12px}
  #sfseo .sfseo-grid{list-style:none;margin:24px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
  #sfseo .sfseo-item{margin:0}
  #sfseo .sfseo-link{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:#fff;border:1px solid #E7DFD0;border-radius:10px;overflow:hidden;height:100%}
  #sfseo .sfseo-img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#F2ECE0}
  #sfseo .sfseo-noimg{background:#F2ECE0}
  #sfseo .sfseo-name{font-weight:600;font-size:15px;padding:12px 14px 2px}
  #sfseo .sfseo-price{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:18px;color:var(--sfseo-primary);padding:0 14px 14px}
  #sfseo .sfseo-cta{text-align:center;margin:36px 0 0}
  #sfseo .sfseo-cta a{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:16px;color:#fff;background:var(--sfseo-primary);text-decoration:none;padding:13px 30px;border-radius:6px}
  @media (max-width:600px){#sfseo .sfseo-grid{grid-template-columns:1fr 1fr;gap:12px}}
</style>
<div class="sfseo-wrap">
  <header class="sfseo-head">
    ${logo}
    <h1>${escapeHtml(store.name)}</h1>
    ${blurb}
    ${closes ? `<p class="sfseo-closes">${escapeHtml(closes)}</p>` : ''}
  </header>
  ${catNav}
  ${items.length ? `<ul class="sfseo-grid">${cards}</ul>` : ''}
  <p class="sfseo-cta"><a href="${escapeHtml(base)}">Shop the ${escapeHtml(store.name)} store</a></p>
</div>
</div>`;
}

// Place the crawlable store content inside the empty CRA root. Fail-safe: if the
// expected markup isn't present (build changed), leave the HTML untouched.
function injectBody(html, bodyHtml) {
  if (!html.includes('<div id="root"></div>')) return html;
  return html.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const slug = slugFromPath(url.pathname);

  // Let assets and the bare directory fall through to the normal SPA response.
  const response = await context.next();
  if (!slug) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const isCanonicalHost = CANONICAL_HOSTS.has(url.hostname.toLowerCase());
  const pageUrl = `${SITE_ORIGIN}/shop/${encodeURIComponent(slug)}`;

  // Sub-path after the slug: [] = store home; ['p'|'b', <id>] = product/bundle;
  // ['cart'|'checkout'] = transactional (never index, never body-render).
  const sub = url.pathname.split('/').filter(Boolean).slice(2);
  const isHome = sub.length === 0;
  const isTransactional = sub[0] === 'cart' || sub[0] === 'checkout';

  const store = await fetchStore(slug);
  if (!store) {
    // Unknown/archived slug → keep the default NSA preview, but canonical + noindex.
    const html0 = await response.text();
    const headers0 = new Headers(response.headers);
    headers0.delete('content-length');
    return new Response(injectNoindex(html0, pageUrl), {
      status: response.status,
      headers: headers0,
    });
  }

  const title = `${store.name} — Team Store`;
  const description =
    store.hero_blurb ||
    `The official ${store.name} store — custom team apparel, decorated and delivered. Order before the window closes.`;
  const image = ogImage(store.banner_url || store.logo_url || DEFAULT_IMAGE);

  // Index only the real, public, open, ungated stores — and only on the canonical
  // host (the raw netlify.app duplicate always stays noindex). Transactional
  // sub-pages never index. Mirrors the directory's open/listed filter
  // (src/storefront/TeamStores.js).
  const indexable =
    store.status === 'open' && store.public_listed === true && store.require_login !== true;
  const robots =
    isCanonicalHost && indexable && !isTransactional
      ? 'index, follow, max-image-preview:large'
      : 'noindex, follow';

  const tags = [
    `  <meta name="description" content="${escapeHtml(description)}" />`,
    `  <link rel="canonical" href="${escapeHtml(pageUrl)}" />`,
    `  <meta name="robots" content="${robots}" />`,
    `  <meta property="og:type" content="website" />`,
    `  <meta property="og:site_name" content="National Sports Apparel" />`,
    `  <meta property="og:title" content="${escapeHtml(title)}" />`,
    `  <meta property="og:description" content="${escapeHtml(description)}" />`,
    `  <meta property="og:image" content="${escapeHtml(image)}" />`,
    `  <meta property="og:url" content="${escapeHtml(pageUrl)}" />`,
    `  <meta name="twitter:card" content="summary_large_image" />`,
    `  <meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}" />`,
    `  <meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n');

  let html = await response.text();
  html = injectTags(html, tags, title);

  // Server-render the store's above-the-fold content into #root so crawlers get
  // real product content — only for the indexable store HOME on the canonical
  // host. Deeper pages (product/cart/checkout) and the noindex duplicate origin
  // keep the head-only treatment; product-page SSR is a later phase.
  if (isHome && isCanonicalHost && indexable) {
    const products = await fetchProducts(store.id);
    if (products.length) html = injectBody(html, renderStoreBody(store, products, slug));
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length'); // body length changed
  return new Response(html, {
    status: response.status,
    headers,
  });
}

export const config = { path: '/shop/*' };
