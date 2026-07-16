// Rich link previews for the Team Shop landing page (nationalteamshop.com).
//
// nationalteamshop.com is a domain alias on this Netlify app, but the SPA ships
// the generic National Sports Apparel <head> tags. Link-preview bots read the
// RAW HTML, so on the Team Shop domain's landing page we swap in Team Shop OG
// tags — same rewrite approach as og-storefront.js, but fully static (no
// lookups) and gated on hostname instead of path.
//
// The config path is '/*' (Netlify edge functions can't match on hostname), so
// the FIRST thing this does is bail with `return undefined` — a pure
// pass-through with zero response handling — unless the request is for
// nationalteamshop.com (apex or a subdomain like www). The existing portal /
// marketing hostnames therefore never take the rewrite path. Fail-open
// throughout: any error → pass through untouched.

const TEAM_SHOP_APEX = 'nationalteamshop.com';

const isTeamShopHostname = (hostname) => {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  // Exact apex or a real subdomain — NOT a mere suffix match, so a lookalike
  // like evilnationalteamshop.com never triggers the rewrite.
  return h === TEAM_SHOP_APEX || h.endsWith(`.${TEAM_SHOP_APEX}`);
};

const TITLE = 'National Team Shop — Your logo. Team-quality gear.';
const DESCRIPTION =
  'Custom team apparel with your logo — decorated and delivered by National Sports Apparel.';

const TAGS = [
  `  <meta property="og:type" content="website" />`,
  `  <meta property="og:site_name" content="National Team Shop" />`,
  `  <meta property="og:title" content="${TITLE}" />`,
  `  <meta property="og:description" content="${DESCRIPTION}" />`,
  `  <meta property="og:url" content="https://${TEAM_SHOP_APEX}/" />`,
  `  <meta name="twitter:card" content="summary" />`,
  `  <meta name="twitter:title" content="${TITLE}" />`,
  `  <meta name="twitter:description" content="${DESCRIPTION}" />`,
].join('\n');

// Same rewrite as og-storefront: drop the default og/twitter tags + title so
// each property appears once, then insert the fresh block after the new title.
function injectTags(html) {
  let out = html;
  out = out.replace(/\s*<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*)"[^>]*>/g, '');
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${TITLE}</title>`);
  return out.replace(/<\/title>/, `</title>\n${TAGS}`);
}

export default async function handler(request, context) {
  try {
    const url = new URL(request.url);
    if (!isTeamShopHostname(url.hostname)) return undefined; // not our domain → untouched pass-through
    // Only the root/landing path gets the static tags (also its /teamshop alias
    // path); assets, /shop/*, etc. fall through untouched.
    const p = url.pathname;
    const isLanding = p === '/' || p === '/index.html' || p === '/teamshop' || p === '/teamshop/';
    if (!isLanding) return undefined;

    const response = await context.next();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return response;

    const html = await response.text();
    const headers = new Headers(response.headers);
    headers.delete('content-length'); // body length changed
    return new Response(injectTags(html), { status: response.status, headers });
  } catch {
    return undefined; // fail open — never block a page over preview tags
  }
}

export const config = { path: '/*' };
