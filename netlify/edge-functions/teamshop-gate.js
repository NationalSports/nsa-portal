// Team Shop launch gate — host-scoped "opening soon" wall for nationalteamshop.com.
//
// While the TEAMSHOP_GATE_KEY env var is set, unkeyed visitors to the Team Shop host get
// a branded holding page; a magic link (?key=<value>) validates and drops a 30-day cookie
// that unlocks the whole site (browse, build, checkout — the real thing) for testers.
// Unset TEAMSHOP_GATE_KEY (+ redeploy) to remove the gate entirely — no code change.
//
// Scope: fires ONLY on nationalteamshop.com / www — the staff portal
// (nsa-portal.netlify.app), club-store hosts, and deploy previews are never touched, so
// this can ship to production while nationalteamshop.com is still dark and affect nothing.
//
// Ordering: declared in netlify.toml [[edge_functions]] (NOT inline) so it runs BEFORE the
// inline /* and /shop/* SEO functions (og-teamshop.js, og-storefront.js) — a gated request
// short-circuits here and those never run. (Declaring it in both toml + inline would demote
// it to inline ordering per Netlify's docs, so it lives in toml only.)
//
// Fail CLOSED on the gated host: any unexpected error still shows the gate rather than
// leaking the site — this is an access wall, so exposure-on-error is the wrong direction.

const TEAM_SHOP_HOSTS = new Set(['nationalteamshop.com', 'www.nationalteamshop.com']);
const COOKIE_NAME = 'nts_gate';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// NSA brand palette (navy / red) — matches the portal's coach-facing theme.
const NAVY = '#192853';
const RED = '#962C32';

// Edge-and-test-safe env read: `Netlify` is a Deno-edge-only global, absent under Jest.
export const env = (k) =>
  (typeof Netlify !== 'undefined' ? Netlify.env.get(k) : (globalThis.process?.env?.[k] ?? '')) || '';

export const isGatedHost = (hostname) => TEAM_SHOP_HOSTS.has(String(hostname || '').toLowerCase());

// Paths that must answer normally even on the gated host: SEO endpoints (so robots/sitemap
// still serve), Netlify internals (serverless API the unlocked SPA calls), and static
// assets. The gate page itself is fully self-contained, so this is hygiene + it keeps the
// unlocked experience's assets flowing.
const ASSET_RE = /\.(?:js|mjs|css|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|map|json|txt|xml|pdf|mp4|webm)$/i;
export const isExcludedPath = (pathname) => {
  const p = String(pathname || '');
  if (p === '/robots.txt' || p === '/sitemap.xml') return true;
  if (p.startsWith('/.netlify/')) return true;
  return ASSET_RE.test(p);
};

// Length-checked constant-time-ish compare — avoids leaking the key length-independently.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(header, name) {
  const src = String(header || '');
  for (const part of src.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

// The cookie stores sha256(key), never the raw key — a leaked cookie can't be replayed as
// a magic link, and the raw shared key never lands in a client-readable store.
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function gateHtml(retry) {
  const note = retry
    ? `<p class="err">That key didn't fit — try again.</p>`
    : '';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>National Team Shop — Opening soon</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: linear-gradient(135deg, ${NAVY} 0%, #0f1a38 100%); color:#fff; padding:24px; }
  .card { width:100%; max-width:420px; text-align:center; }
  .badge { display:inline-block; font-size:12px; letter-spacing:.18em; text-transform:uppercase;
    color:#fff; background:${RED}; padding:6px 14px; border-radius:999px; margin-bottom:22px; font-weight:700; }
  h1 { font-size:26px; margin:0 0 10px; font-weight:800; }
  p { font-size:15px; line-height:1.5; color:#cfd6e6; margin:0 0 24px; }
  form { display:flex; gap:8px; }
  input { flex:1; padding:13px 14px; border-radius:8px; border:1px solid rgba(255,255,255,.25);
    background:rgba(255,255,255,.08); color:#fff; font-size:15px; }
  input::placeholder { color:#9aa6c2; }
  button { padding:13px 20px; border:none; border-radius:8px; background:${RED}; color:#fff;
    font-weight:700; font-size:15px; cursor:pointer; }
  .err { color:#ffb4b4; font-size:13px; margin:14px 0 0; }
  .foot { margin-top:26px; font-size:12px; color:#8895b3; }
</style></head>
<body><div class="card">
  <span class="badge">National Team Shop</span>
  <h1>Opening soon.</h1>
  <p>We're doing final fittings. Have an early-access key? Enter it below.</p>
  <form method="get" action="">
    <input type="password" name="key" placeholder="Early-access key" autocomplete="off" autofocus aria-label="Early-access key">
    <button type="submit">Enter</button>
  </form>
  ${note}
  <div class="foot">National Sports Apparel</div>
</div></body></html>`;
}

function gateResponse(retry) {
  return new Response(gateHtml(retry), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

export default async function handler(request, context) {
  try {
    const key = env('TEAMSHOP_GATE_KEY');
    if (!key) return undefined; // gate disabled — the launch kill switch

    const url = new URL(request.url);
    if (!isGatedHost(url.hostname)) return undefined; // other hosts untouched
    if (isExcludedPath(url.pathname)) return undefined;

    const expected = await sha256Hex(key);

    // Magic link: ?key=<value>. Validate, strip the param, drop the unlock cookie, redirect.
    const provided = url.searchParams.get('key');
    if (provided !== null) {
      if (!safeEqual(provided, key)) return gateResponse(true);
      url.searchParams.delete('key');
      const qs = url.searchParams.toString();
      const location = url.pathname + (qs ? `?${qs}` : '');
      return new Response(null, {
        status: 302,
        headers: {
          Location: location || '/',
          'Set-Cookie': `${COOKIE_NAME}=${expected}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}; Path=/`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Already unlocked → let the real site through.
    if (safeEqual(readCookie(request.headers.get('cookie'), COOKIE_NAME), expected)) return undefined;

    return gateResponse(false);
  } catch (_) {
    // Fail closed: if the gate is armed on this host, show the wall rather than leak the
    // site. Only if even that determination throws do we fall through.
    try {
      if (env('TEAMSHOP_GATE_KEY') && isGatedHost(new URL(request.url).hostname)) return gateResponse(false);
    } catch (_2) { /* fall through */ }
    return undefined;
  }
}
