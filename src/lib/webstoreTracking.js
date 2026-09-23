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

// Point the tracker at the store being shown. Only open stores are tracked, so
// staff previewing a draft or closed store never shows up as a shopper.
export function setTrackedStore(id, isOpen) {
  if (id !== storeId) { flush(true); seen = new Set(); }
  storeId = id || null;
  enabled = !!(id && isOpen) && !isBot();
  if (enabled) hookUnload();
}

// Record one shopper action. View-type events count once per page load; cart
// adds always count; an order counts once per order id.
export function trackEvent(event, extra = {}) {
  if (!enabled || !storeId) return;
  const once = event === 'add_to_cart' ? null : event + ':' + (extra.productId || extra.orderId || '');
  if (once) { if (seen.has(once)) return; seen.add(once); }
  queue.push({ event, ...extra });
  if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS);
}

// Test hook: reset module state between tests.
export function _resetTracking() { storeId = null; enabled = false; queue = []; seen = new Set(); if (timer) clearTimeout(timer); timer = null; }
