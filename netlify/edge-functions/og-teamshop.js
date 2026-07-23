// SEO for the retail Team Shop (nationalteamshop.com).
//
// The Team Shop is a client-rendered SPA (createRoot into an empty #root), so
// crawlers that don't run JS — and JS-render is unreliable behind client-side
// Supabase fetches — see a bare shell with generic metadata and no product
// content. This edge function rewrites the served HTML before it reaches the
// crawler, for the PUBLIC Team Shop routes only:
//   • <head> — per-route title, description, canonical (→ nationalteamshop.com),
//     lifecycle robots, OG/Twitter.
//   • <body> — landing / catalog / product get their above-the-fold content
//     rendered INTO #root (React's createRoot clears + replaces it on mount, so
//     it's a no-JS fallback, not hydration — identical HTML for bots and humans,
//     no cloaking).
//   • JSON-LD — Organization/WebSite on the landing, ItemList + breadcrumbs on
//     catalog, Product + breadcrumbs on product pages. NO Offer price: the Team
//     Shop is quote-based and never shows a price, so marking one up would be an
//     invisible/mismatched price (Google policy).
//
// config path is '/*' (edge functions can't match on hostname). It bails
// (`return undefined`, pass-through) unless this is a Team Shop request AND a
// route we own — so /shop/* (og-storefront), /team-stores (directory-seo),
// checkout/cart/account/search, assets, and every staff/app route are untouched.
// Fail-open throughout: any error → pass through.

const TEAM_SHOP_APEX = 'nationalteamshop.com';
const SITE_ORIGIN = `https://${TEAM_SHOP_APEX}`;
const GRID_LIMIT = 48;

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

// Launch categories the catalog renders. Mirrors src/teamshop/categories.js
// (inline — edge functions can't import the CJS src module). `db` is the primary
// products.category value the RPC filters on; LAUNCH_DBVALUES holds every value
// (incl. alternate spellings) used to keep the "all" grid to launch products.
// HAND-SYNCED COPY of LAUNCH_CATEGORIES in src/teamshop/categories.js — keep in step (see also sitemap.js)
const CATEGORIES = [
  { key: 'quarter_zips', label: '1/4 Zips', db: '1/4 Zips' },
  { key: 'hoodies', label: 'Hoodies & Fleece', db: 'Hoods' },
  { key: 'polos', label: 'Polos', db: 'Polos' },
  { key: 'outerwear', label: 'Outerwear', db: 'Outerwear' },
  { key: 'hats', label: 'Hats', db: 'Hats' },
  { key: 'tees', label: 'Tees', db: 'Tees' },
  { key: 'bags', label: 'Bags', db: 'Bags' },
  { key: 'shorts', label: 'Shorts', db: 'Shorts' },
  { key: 'footwear', label: 'Footwear', db: 'Footwear' },
];
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
const LAUNCH_DBVALUES = new Set(['1/4 Zips', 'Hoods', 'Hood', 'Polos', 'Outerwear', 'Hats', 'Beanies', 'Tees', 'Bags', 'Shorts', 'Footwear']);

const escapeHtml = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const anonHeaders = () => ({
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  Accept: 'application/json',
});

const isTeamShopHostname = (hostname) => {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return h === TEAM_SHOP_APEX || h.endsWith(`.${TEAM_SHOP_APEX}`);
};

// JSON-LD, escaped so product text (or a stray "</script>") can't break out.
function jsonLdScript(obj) {
  return `  <script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
}

// ── Data (all anon-readable) ─────────────────────────────────────────
async function fetchCatalog(categoryDb) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_products`, {
      method: 'POST',
      headers: { ...anonHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_query: null,
        p_category: categoryDb || null,
        p_vendor_id: null,
        p_color_category: null,
        p_in_stock: false,
        p_limit: 250,
        p_offset: 0,
      }),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    // Keep launch-category products, dedupe by name (fold colorways), cap the grid.
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (!r || !r.sku || !r.name) continue;
      if (!LAUNCH_DBVALUES.has(String(r.category || '').trim())) continue;
      const key = String(r.name).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= GRID_LIMIT) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchProduct(sku) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !sku) return null;
  const qs = new URLSearchParams({
    sku: `eq.${sku}`,
    select: 'sku,name,brand,color,category,image_front_url,image_back_url,available_sizes',
    limit: '1',
  });
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?${qs}`, { headers: anonHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

// Perf: tiny in-isolate TTL cache in front of fetchCatalog/fetchProduct. Edge
// isolates persist across requests best-effort, so this cuts repeat Supabase
// calls on a hot page to ~1/min/isolate. Capped so a long-lived isolate can't
// grow it unbounded; oldest entry evicted first (Map iterates insertion order).
const DATA_CACHE_TTL_MS = 60_000;
const DATA_CACHE_MAX = 500;
const dataCache = new Map(); // key -> { value, expires }
function cacheGet(key) {
  const hit = dataCache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) { dataCache.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key, value) {
  if (dataCache.size >= DATA_CACHE_MAX) dataCache.delete(dataCache.keys().next().value); // evict oldest
  dataCache.set(key, { value, expires: Date.now() + DATA_CACHE_TTL_MS });
}
async function cachedFetchCatalog(categoryDb) {
  const key = `catalog:${categoryDb || 'all'}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await fetchCatalog(categoryDb);
  cacheSet(key, value);
  return value;
}
async function cachedFetchProduct(sku) {
  const key = `product:${sku}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = await fetchProduct(sku);
  cacheSet(key, value);
  return value;
}

const prodImg = (p) => p && (p.image_front_url || p.image_url || '');
const productHref = (sku) => `/product/${encodeURIComponent(sku)}`;

// ── HTML injection ───────────────────────────────────────────────────
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
  if (!bodyHtml || !html.includes('<div id="root"></div>')) return html;
  return html.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
}

// ── SSR bodies (no-JS fallback inside #root; on-brand, semantic) ──────
const SHELL_STYLE = `
  #ntseo{font-family:'Source Sans 3',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#2A2F3E;background:#F7F8FB;min-height:100vh}
  #ntseo .nt-wrap{max-width:1180px;margin:0 auto;padding:32px 20px 64px}
  #ntseo h1{font-family:'Barlow Condensed','Arial Narrow',Impact,sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(32px,5.5vw,60px);line-height:1;margin:0 0 12px;color:#192853}
  #ntseo .nt-sub{font-size:17px;color:#5A6075;max-width:640px;margin:0 0 8px}
  #ntseo .nt-cats{list-style:none;display:flex;flex-wrap:wrap;gap:10px;padding:0;margin:18px 0 0}
  #ntseo .nt-cats a{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:15px;color:#192853;background:#fff;border:1px solid #E7DFD0;border-radius:999px;padding:8px 16px;text-decoration:none}
  #ntseo .nt-grid{list-style:none;margin:24px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px}
  #ntseo .nt-link{display:flex;flex-direction:column;text-decoration:none;color:inherit;background:#fff;border:1px solid #E7DFD0;border-radius:10px;overflow:hidden;height:100%}
  #ntseo .nt-img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#EEF1F6}
  #ntseo .nt-brand{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#8A2B2F;padding:12px 14px 0}
  #ntseo .nt-name{font-weight:600;font-size:15px;padding:2px 14px 14px}
  #ntseo .nt-pdp{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:8px}
  #ntseo .nt-pdp-img{width:100%;aspect-ratio:1/1;object-fit:contain;background:#fff;border:1px solid #E7DFD0;border-radius:12px}
  #ntseo .nt-meta{font-size:15px;color:#5A6075;margin:6px 0}
  #ntseo .nt-cta{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:.06em;font-size:16px;color:#fff;background:#962C32;text-decoration:none;padding:13px 28px;border-radius:6px;margin-top:16px}
  @media (max-width:700px){#ntseo .nt-pdp{grid-template-columns:1fr}#ntseo .nt-grid{grid-template-columns:1fr 1fr;gap:12px}}
`;
const shell = (inner) => `<div id="ntseo"><style>${SHELL_STYLE}</style><div class="nt-wrap">${inner}</div></div>`;

const catCard = (p) => {
  const img = prodImg(p)
    ? `<img class="nt-img" src="${escapeHtml(prodImg(p))}" alt="${escapeHtml(p.name)}" loading="lazy" width="300" height="300" />`
    : `<span class="nt-img" aria-hidden="true"></span>`;
  return (
    `<li><a class="nt-link" href="${escapeHtml(productHref(p.sku))}">` +
    img +
    (p.brand ? `<span class="nt-brand">${escapeHtml(p.brand)}</span>` : '') +
    `<span class="nt-name">${escapeHtml(p.name)}</span></a></li>`
  );
};

function renderLanding(featured) {
  const cats = CATEGORIES.map(
    (c) => `<li><a href="/catalog?category=${escapeHtml(c.key)}">${escapeHtml(c.label)}</a></li>`
  ).join('');
  const grid = featured.length ? `<ul class="nt-grid">${featured.map(catCard).join('')}</ul>` : '';
  return shell(
    `<h1>National Team Shop</h1>` +
    `<p class="nt-sub">Custom team apparel with your logo — decorated and delivered by National Sports Apparel. Hoodies, polos, tees, hats, bags and more, quote-priced for your team.</p>` +
    `<nav aria-label="Shop by category"><ul class="nt-cats">${cats}</ul></nav>` +
    grid +
    `<p><a class="nt-cta" href="/catalog">Shop the catalog</a></p>`
  );
}

function renderCatalog(products, heading) {
  const grid = products.length ? `<ul class="nt-grid">${products.map(catCard).join('')}</ul>` : '';
  return shell(
    `<h1>${escapeHtml(heading)}</h1>` +
    `<p class="nt-sub">Custom team apparel with your logo, decorated and delivered. Quote-priced for your team.</p>` +
    grid
  );
}

function renderProduct(p) {
  const sizes = Array.isArray(p.available_sizes) ? p.available_sizes.filter(Boolean).join(', ') : '';
  const img = prodImg(p)
    ? `<img class="nt-pdp-img" src="${escapeHtml(prodImg(p))}" alt="${escapeHtml(p.name)}" width="600" height="600" />`
    : `<span class="nt-pdp-img" aria-hidden="true"></span>`;
  return shell(
    `<div class="nt-pdp"><div>${img}</div><div>` +
    (p.brand ? `<p class="nt-brand" style="padding:0">${escapeHtml(p.brand)}</p>` : '') +
    `<h1>${escapeHtml(p.name)}</h1>` +
    (p.category ? `<p class="nt-meta">${escapeHtml(p.category)}</p>` : '') +
    (p.color ? `<p class="nt-meta">Color: ${escapeHtml(p.color)}</p>` : '') +
    (sizes ? `<p class="nt-meta">Sizes: ${escapeHtml(sizes)}</p>` : '') +
    `<p class="nt-meta">Add your team logo — decorated and delivered. Pricing is quoted for your team.</p>` +
    `<a class="nt-cta" href="/catalog">Start your order</a>` +
    `</div></div>`
  );
}

// ── JSON-LD ──────────────────────────────────────────────────────────
const ORG = { '@type': 'Organization', name: 'National Sports Apparel', url: 'https://nationalsportsapparel.com' };

function landingJsonLd() {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'OnlineStore',
        '@id': `${SITE_ORIGIN}/#store`,
        name: 'National Team Shop',
        url: `${SITE_ORIGIN}/`,
        description: 'Custom team apparel with your logo — decorated and delivered by National Sports Apparel.',
        parentOrganization: ORG,
      },
      { '@type': 'WebSite', url: `${SITE_ORIGIN}/`, name: 'National Team Shop' },
    ],
  });
}
function catalogJsonLd(products, heading, canonical) {
  const graph = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Catalog', item: `${SITE_ORIGIN}/catalog` },
        { '@type': 'ListItem', position: 2, name: heading, item: canonical },
      ],
    },
  ];
  if (products.length) {
    graph.push({
      '@type': 'ItemList',
      itemListElement: products.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: p.name,
        url: `${SITE_ORIGIN}${productHref(p.sku)}`,
      })),
    });
  }
  return jsonLdScript({ '@context': 'https://schema.org', '@graph': graph });
}
function productJsonLd(p, canonical) {
  // No `offers` — the Team Shop never shows a price (quote-based), so a marked-up
  // price would be invisible/unverifiable. Mark up the product identity only.
  const product = {
    '@type': 'Product',
    name: p.name,
    sku: p.sku,
    category: p.category || undefined,
    url: canonical,
  };
  if (prodImg(p)) product.image = prodImg(p);
  if (p.brand) product.brand = { '@type': 'Brand', name: p.brand };
  if (p.color) product.color = p.color;
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      product,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Catalog', item: `${SITE_ORIGIN}/catalog` },
          { '@type': 'ListItem', position: 2, name: p.name, item: canonical },
        ],
      },
    ],
  });
}

// ── Routing ──────────────────────────────────────────────────────────
// Return the Team Shop base for this request ('' on the apex, '/teamshop' on any
// other host that's under /teamshop for previews), or null if not a Team Shop
// request at all.
function teamShopBase(url) {
  if (isTeamShopHostname(url.hostname)) return '';
  const p = url.pathname;
  if (p === '/teamshop' || p === '/teamshop/' || p.indexOf('/teamshop/') === 0) return '/teamshop';
  return null;
}

function classify(pathAfterBase) {
  const segs = pathAfterBase.replace(/\/+$/, '').split('/').filter(Boolean);
  if (segs.length === 0) return { name: 'landing' };
  // Landing aliases: the static index fallback, and the /teamshop path itself
  // (reachable directly on the real apex, not just as a preview-host base) —
  // both must render the same as '/'.
  if (segs.length === 1 && (segs[0] === 'index.html' || segs[0] === 'teamshop')) {
    return { name: 'landing' };
  }
  switch (segs[0]) {
    case 'catalog': return { name: 'catalog' };
    case 'product': return { name: 'product', sku: decodeURIComponent(segs[1] || '') };
    case 'stores': return { name: 'stores' };
    case 'faq': return { name: 'faq' };
    case 'decoration': return { name: 'decoration' };
    default: return { name: 'other' };
  }
}

const OG = (title, description, image, canonical) =>
  [
    `  <meta name="description" content="${escapeHtml(description)}" />`,
    `  <link rel="canonical" href="${escapeHtml(canonical)}" />`,
  ].concat(
    [
      `  <meta property="og:type" content="website" />`,
      `  <meta property="og:site_name" content="National Team Shop" />`,
      `  <meta property="og:title" content="${escapeHtml(title)}" />`,
      `  <meta property="og:description" content="${escapeHtml(description)}" />`,
      image ? `  <meta property="og:image" content="${escapeHtml(image)}" />` : '',
      `  <meta property="og:url" content="${escapeHtml(canonical)}" />`,
      `  <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `  <meta name="twitter:title" content="${escapeHtml(title)}" />`,
      `  <meta name="twitter:description" content="${escapeHtml(description)}" />`,
      image ? `  <meta name="twitter:image" content="${escapeHtml(image)}" />` : '',
    ].filter(Boolean)
  );

export default async function handler(request, context) {
  try {
    ensureEnv();
    const url = new URL(request.url);
    const base = teamShopBase(url);
    if (base === null) return undefined; // not a Team Shop request

    const pathAfterBase = base ? url.pathname.slice(base.length) || '/' : url.pathname;
    const route = classify(pathAfterBase);
    if (route.name === 'other') return undefined; // /order,/cart,/account,/search,assets,… → untouched

    const isApex = isTeamShopHostname(url.hostname);
    const robots = isApex ? 'index, follow, max-image-preview:large' : 'noindex, follow';

    // Perf: pick the (cached) Supabase fetch this route needs, then start it
    // ALONGSIDE context.next() (Promise.all) rather than awaiting it first —
    // the Supabase round trip overlaps the origin fetch instead of adding to
    // it on every human page view.
    let cat = null; // resolved category for the 'catalog' route; reused below
    let dataPromise = Promise.resolve(null);
    if (route.name === 'landing') {
      dataPromise = isApex ? cachedFetchCatalog(null) : Promise.resolve([]);
    } else if (route.name === 'catalog') {
      const key = url.searchParams.get('category');
      cat = key ? CATEGORY_BY_KEY[key] : null;
      dataPromise = isApex ? cachedFetchCatalog(cat ? cat.db : null) : Promise.resolve([]);
    } else if (route.name === 'product') {
      dataPromise = route.sku ? cachedFetchProduct(route.sku) : Promise.resolve(null);
    }
    const [response, data] = await Promise.all([context.next(), dataPromise]);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    // Resolve per-route SEO from the data fetched above.
    let title, description, canonical, image = '', body = '', ld = '';

    if (route.name === 'landing') {
      title = 'National Team Shop — Your logo. Team-quality gear.';
      description = 'Custom team apparel with your logo — decorated and delivered by National Sports Apparel.';
      canonical = `${SITE_ORIGIN}/`;
      const featured = data || [];
      body = renderLanding(featured.slice(0, 8));
      ld = landingJsonLd();
    } else if (route.name === 'catalog') {
      const heading = cat ? cat.label : 'Custom Team Apparel Catalog';
      title = `${heading} | National Team Shop`;
      description = `Shop ${cat ? cat.label.toLowerCase() : 'custom team apparel'} with your team logo — decorated and delivered. Quote-priced for your team.`;
      canonical = cat ? `${SITE_ORIGIN}/catalog?category=${encodeURIComponent(cat.key)}` : `${SITE_ORIGIN}/catalog`;
      const products = data || [];
      body = renderCatalog(products, heading);
      ld = catalogJsonLd(products, heading, canonical);
    } else if (route.name === 'product') {
      canonical = `${SITE_ORIGIN}${productHref(route.sku)}`;
      const product = data;
      if (!product) {
        // Unknown sku → head-only, noindex (don't index a phantom product).
        const html0 = await response.text();
        const tags0 = [
          `  <link rel="canonical" href="${escapeHtml(canonical)}" />`,
          `  <meta name="robots" content="noindex, follow" />`,
        ].join('\n');
        const h0 = new Headers(response.headers);
        h0.delete('content-length');
        return new Response(injectHead(html0, tags0, 'Product | National Team Shop'), { status: response.status, headers: h0 });
      }
      title = `${product.name} | National Team Shop`;
      description = `${product.name}${product.brand ? ' by ' + product.brand : ''} — add your team logo, decorated and delivered by National Sports Apparel.`;
      image = prodImg(product);
      body = renderProduct(product);
      ld = productJsonLd(product, canonical);
    } else {
      // stores / faq / decoration → head-only SEO, no body SSR (yet).
      const headings = {
        stores: ['Team Stores | National Team Shop', 'Find and shop your team’s online store from National Sports Apparel.'],
        faq: ['FAQ | National Team Shop', 'Answers about custom team apparel, logos, decoration, ordering, and delivery.'],
        decoration: ['Decoration Methods | National Team Shop', 'Embroidery, DTF, and heat-applied decoration for custom team apparel.'],
      };
      [title, description] = headings[route.name];
      canonical = `${SITE_ORIGIN}/${route.name}`;
    }

    const tags = OG(title, description, image, canonical);
    tags.splice(2, 0, `  <meta name="robots" content="${robots}" />`);
    if (ld) tags.push(ld);

    let html = await response.text();
    html = injectHead(html, tags.join('\n'), title);
    if (isApex && body) html = injectBody(html, body);

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(html, { status: response.status, headers });
  } catch {
    return undefined; // fail open — never block a page over SEO tags
  }
}

export const config = { path: '/*' };
