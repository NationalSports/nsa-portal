// Host-aware robots.txt for the portal Netlify site.
//
// The portal app is served under several hosts (Netlify domain aliases):
//   • nationalteamshop.com              — public "National Team Shop" storefronts
//   • connect.nationalsportsapparel.com — staff/coach portal (auth-gated app)
//   • nsa-portal.netlify.app            — raw Netlify origin (+ deploy previews)
// A single static /robots.txt can't vary per host, so this edge function emits
// the right rules for each.
//
// Only the canonical store domain is crawlable, and even there only the
// storefront routes (/shop, /team-stores) plus the render assets under /static —
// never the app/checkout routes, since nationalteamshop.com is an alias of the
// WHOLE portal app (its /coach, /adidas, /onboarding, … routes all resolve too).
// Every other host is fully disallowed so the app shell and the off-brand
// netlify.app duplicate never get indexed.

const CANONICAL_HOSTS = new Set(['nationalteamshop.com', 'www.nationalteamshop.com']);

// Longest-match wins in Google/Bing, and the specific Disallows are listed first
// so first-match crawlers also keep checkout/cart out while /shop/ stays open.
const STORE_ROBOTS = `User-agent: *
Disallow: /shop/*/checkout
Disallow: /shop/*/cart
Allow: /shop/
Allow: /team-stores
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
