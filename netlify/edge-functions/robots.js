// Host-aware robots.txt for the portal Netlify site.
//
// The portal app is served under several hosts (Netlify domain aliases):
//   • nationalteamshop.com              — public "National Team Shop" storefronts
//   • connect.nationalsportsapparel.com — staff/coach portal (auth-gated app)
//   • nsa-portal.netlify.app            — raw Netlify origin (+ deploy previews)
// A single static /robots.txt can't vary per host, so this edge function emits
// the right rules for each.
//
// nationalteamshop.com is an alias of the WHOLE portal app, so besides the public
// Team Shop retail storefront it also serves staff/app routes (/onboarding, /auth,
// /adidas, /teamshop-queue, /production, /floor-station, /vendor-digitizing, the
// coach portal, …). So this is an ALLOW-LIST: default-deny (`Disallow: /`) with the
// public retail surface opened up, so a new staff route never leaks into the index.
//
// Public (indexable) on nationalteamshop.com:
//   • Team Shop retail — / (home), /catalog, /product/<sku>, /stores, /decoration, /faq
//   • Club stores (still live here) — /shop/<slug>, /team-stores
//   • Render assets — /static
// Deny: the funnel (/order, /cart, /account, /search) + club-store /shop/*/cart|
// checkout fall under the catch-all (or an explicit rule where a broader Allow
// would otherwise expose them). Every non-canonical host is fully disallowed so the
// staff portal and the off-brand netlify.app duplicate never get indexed.

const CANONICAL_HOSTS = new Set(['nationalteamshop.com', 'www.nationalteamshop.com']);

// `/$` anchors the home page so it's crawlable without `Allow: /` opening the whole
// app. Specific Disallows come first (first-match crawlers); Google/Bing use
// longest-match, under which the anchored/deeper rules win as intended.
const STORE_ROBOTS = `User-agent: *
Disallow: /shop/*/cart
Disallow: /shop/*/checkout
Allow: /$
Allow: /catalog
Allow: /product/
Allow: /stores
Allow: /decoration
Allow: /faq
Allow: /team-stores
Allow: /shop/
Allow: /static/
Allow: /sitemap.xml
Disallow: /

Sitemap: https://nationalteamshop.com/sitemap.xml
`;

const BLOCK_ALL = `User-agent: *
Disallow: /
`;

export default function handler(request) {
  const host = new URL(request.url).hostname.toLowerCase();
  const body = CANONICAL_HOSTS.has(host) ? STORE_ROBOTS : BLOCK_ALL;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

export const config = { path: '/robots.txt' };
