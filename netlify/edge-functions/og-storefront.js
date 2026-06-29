// Rich link previews for public team stores (/shop/<slug>).
//
// The storefront is a client-rendered React SPA, so every store ships the same
// static index.html with only the generic National Sports Apparel preview tags.
// Link-preview bots (iMessage, Slack, Facebook, X) read Open Graph <meta> tags
// from the RAW HTML and never execute JavaScript — so without this, texting a
// store link shows a bare domain + generic icon instead of the store's image.
//
// This edge function runs on every /shop/* request. For a real store slug it
// looks up that store in the anon-readable `webstores_public` view and rewrites
// the <title> + og:/twitter: tags in index.html with the store's own name,
// tagline, and banner (falling back to logo, then the NSA default) BEFORE the
// HTML reaches the bot. Human visitors still get the same HTML and React boots
// over it normally — only the <head> metadata changed.

const SUPABASE_URL =
  Netlify.env.get('REACT_APP_SUPABASE_URL') || Netlify.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY =
  Netlify.env.get('REACT_APP_SUPABASE_ANON_KEY') || '';

const SITE_ORIGIN = 'https://nationalsportsapparel.com';
const DEFAULT_IMAGE = 'https://nsa-portal.netlify.app/NEW%20NSA%20Logo%20on%20white.png';

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

// Pull the <slug> out of /shop/<slug>[/...]. Bare /shop or /shop/ has none.
const slugFromPath = (pathname) => {
  const segs = pathname.split('/').filter(Boolean); // ['shop', '<slug>', ...]
  return segs[0] === 'shop' && segs[1] ? decodeURIComponent(segs[1]) : '';
};

async function fetchStore(slug) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const qs = new URLSearchParams({
    slug: `eq.${slug}`,
    select: 'name,logo_url,banner_url,hero_blurb,status',
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

// Replace the existing og/twitter/title tags with store-specific ones. The
// static defaults in index.html are removed first so each property appears once.
function injectTags(html, tags, title) {
  let out = html;
  // Drop the default OG/Twitter meta block + title so we don't emit duplicates.
  out = out.replace(/\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>/g, '');
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(title)}</title>`);
  // Insert the fresh tags right after the (now store-specific) <title>.
  return out.replace(/<\/title>/, `</title>\n${tags}`);
}

export default async function handler(request, context) {
  const url = new URL(request.url);
  const slug = slugFromPath(url.pathname);

  // Let assets and the bare directory fall through to the normal SPA response.
  const response = await context.next();
  if (!slug) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const store = await fetchStore(slug);
  if (!store) return response; // unknown slug → keep default NSA preview

  const title = `${store.name} — Team Store`;
  const description =
    store.hero_blurb ||
    `The official ${store.name} store — custom team apparel, decorated and delivered. Order before the window closes.`;
  const image = ogImage(store.banner_url || store.logo_url || DEFAULT_IMAGE);
  const pageUrl = `${SITE_ORIGIN}/shop/${encodeURIComponent(slug)}`;

  const tags = [
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

  const html = await response.text();
  const rewritten = injectTags(html, tags, title);

  const headers = new Headers(response.headers);
  headers.delete('content-length'); // body length changed
  return new Response(rewritten, {
    status: response.status,
    headers,
  });
}

export const config = { path: '/shop/*' };
