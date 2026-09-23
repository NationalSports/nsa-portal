// Anonymous shopper-funnel tracking for the club webstore storefront.
//
// Records what a shopper did (opened the store, viewed an item, added to cart,
// opened the cart, started checkout, placed an order) so the Analytics tab and
// Reports → Webstores can show where parents drop off. Nothing personal is sent:
// the shopper is a random id kept in this browser's localStorage.
//
// Fire-and-forget by design — tracking must never slow down, break, or block a
// sale. Every browser API is wrapped, and every failure is swallowed.

const ENDPOINT = '/.netlify/functions/webstore-track';
const SID_KEY = 'nsa_ws_sid';
const FLUSH_MS = 800;

let storeId = null;
let enabled = false;
let queue = [];
let timer = null;
let seen = new Set();
let memSid = null;

// Where this shopper came from, read once from the landing URL (before the
// storefront's own navigation changes it). Tagged links (?src=email, ?src=qr —
// see _storefrontSrcUrl in Webstores.js) win; then a roster link; then the
// referring site; otherwise 'direct' (typed, bookmarked, or a texted link).
const SOURCE_ALIASES = {
  email: 'email', newsletter: 'email', mail: 'email',
  text: 'text', sms: 'text', txt: 'text',
  qr: 'qr', qrcode: 'qr',
  flyer: 'flyer', poster: 'flyer', print: 'flyer',
  social: 'social', facebook: 'social', fb: 'social', instagram: 'social', ig: 'social', twitter: 'social', x: 'social', tiktok: 'social',
  coach: 'coach', team: 'coach', website: 'website', site: 'website',
  reminder: 'reminder',
};
export function trafficSource(search, referrer, ownHost) {
  let q; try { q = new URLSearchParams(search || ''); } catch { q = new URLSearchParams(''); }
  const tag = String(q.get('src') || q.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (tag) return SOURCE_ALIASES[tag] || 'other';
  if (q.get('player')) return 'roster_link';
  let host = '';
  try { host = referrer ? new URL(referrer).hostname.toLowerCase() : ''; } catch {}
  if (!host || host === String(ownHost || '').toLowerCase()) return 'direct';
  if (/(^|\.)(facebook|fb|instagram|twitter|x|t|tiktok|linkedin|pinterest|snapchat|reddit)\.(com|co)$|lm\.facebook\.com$/.test(host)) return 'social';
  if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia)\./.test(host) && !/^mail\./.test(host)) return 'search';
  if (/^(mail|outlook|webmail)\.|(^|\.)outlook\.(live|office)\.com$/.test(host)) return 'email';
  if (/nationalsportsapparel\.com$|nsa-portal\.netlify\.app$/.test(host)) return 'direct';
  return 'other_site';
}
let landingSource = 'direct';
try { landingSource = trafficSource(window.location.search, document.referrer, window.location.hostname); } catch {}

function randomId() {
  try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID().replace(/-/g, ''); } catch {}
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
}

// One id per browser, shared across stores (the funnel counts per store).
export function shopperId() {
  try {
    let id = localStorage.getItem(SID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = randomId(); localStorage.setItem(SID_KEY, id); }
    return id;
  } catch {
    if (!memSid) memSid = randomId();
    return memSid;
  }
}

export function deviceType(ua, width) {
  const u = String(ua || '');
  if (/iPad|Tablet|PlayBook|Silk/i.test(u) || (/Android/i.test(u) && !/Mobile/i.test(u))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(u)) return 'mobile';
  // iPadOS reports a desktop Mac user agent; a touch screen gives it away.
  if (/Macintosh/i.test(u) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) return 'tablet';
  if (width && width < 700) return 'mobile';
  return 'desktop';
}

function isBot() {
  try {
    if (navigator.webdriver) return true; // automated browsers, incl. our own e2e runs
    return /bot|crawl|spider|slurp|preview|lighthouse|headless/i.test(navigator.userAgent || '');
  } catch { return true; }
}

// Staff aren't shoppers. The portal keeps the logged-in team member in
// localStorage('nsa_user') on this same site, so a browser that has ever been
// logged in to the portal gets a sticky flag and is never tracked — even after
// the staff member logs out.
const STAFF_KEY = 'nsa_staff_device';
export function isStaffBrowser() {
  try {
    if (localStorage.getItem('nsa_user')) { localStorage.setItem(STAFF_KEY, '1'); return true; }
    return localStorage.getItem(STAFF_KEY) === '1';
  } catch { return false; }
}

function flush(useKeepalive) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length || !storeId) return;
  const events = queue.splice(0, 25);
  let device = 'desktop';
  try { device = deviceType(navigator.userAgent, window.innerWidth); } catch {}
  const body = JSON.stringify({ storeId, sessionId: shopperId(), device, events });
  try {
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: !!useKeepalive }).catch(() => {});
  } catch {}
  if (queue.length) timer = setTimeout(() => flush(false), FLUSH_MS);
}

let unloadHooked = false;
function hookUnload() {
  if (unloadHooked) return;
  unloadHooked = true;
  try {
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(true); });
  } catch {}
}

// Point the tracker at the store being shown. Only open stores are tracked, and
// never from a staff browser, so the team never shows up as shoppers.
export function setTrackedStore(id, isOpen) {
  if (id !== storeId) { flush(true); seen = new Set(); }
  storeId = id || null;
  enabled = !!(id && isOpen) && !isBot() && !isStaffBrowser();
  if (enabled) hookUnload();
}

// Record one shopper action. View-type events count once per page load; cart
// adds always count; an order counts once per order id.
export function trackEvent(event, extra = {}) {
  if (!enabled || !storeId) return;
  const once = event === 'add_to_cart' ? null : event + ':' + (extra.productId || extra.orderId || '');
  if (once) { if (seen.has(once)) return; seen.add(once); }
  queue.push(event === 'store_view' ? { event, source: landingSource, ...extra } : { event, ...extra });
  if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS);
}

// Test hook: reset module state between tests.
export function _resetTracking() { storeId = null; enabled = false; queue = []; seen = new Set(); if (timer) clearTimeout(timer); timer = null; }
