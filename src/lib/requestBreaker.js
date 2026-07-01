// Global request circuit breaker for the Supabase clients.
//
// Root-cause guard for the recurring "a stale tab melts the database" incidents: a render or
// effect bug can put a Supabase fetch into a runaway loop that hammers ONE endpoint thousands of
// times per second (save_estimate, inventory_unified, …), and nothing stopped the browser from
// sending them. makeBreakerFetch() returns a fetch wrapper to pass as the client's `global.fetch`:
// when any /rest/v1 path exceeds a runaway threshold it short-circuits further calls to that path
// for a cooldown — returning a synthetic 429 the callers already treat as an error — so the
// requests never leave the browser and the database sees nothing.
//
// Per-path and per-tab: one looping endpoint trips on its own without touching legit traffic.
// Legit bursts (the initial paginated load, the adidas bulk fetch of ~50 calls) stay far under the
// threshold. Only data calls are guarded; auth/realtime/token endpoints are never throttled.
export function makeBreakerFetch(opts = {}) {
  const WINDOW_MS = opts.windowMs || 10000;
  const MAX_PER_WINDOW = opts.maxPerWindow || 300; // >this many to one path in WINDOW_MS ⇒ runaway
  const COOLDOWN_MS = opts.cooldownMs || 15000;
  const label = opts.label || 'circuit-breaker';

  const baseFetch = (typeof window !== 'undefined' && window.fetch)
    ? window.fetch.bind(window)
    : ((...a) => fetch(...a));
  const windowByPath = new Map(); // path -> recent request timestamps
  const trippedUntil = new Map(); // path -> epoch-ms until which the path is short-circuited
  let lastLoggedAt = 0;

  const pathOf = (u) => {
    try { return new URL(typeof u === 'string' ? u : u.url).pathname; }
    catch { return String(u).split('?')[0]; }
  };
  const throttled = () => Promise.resolve(new Response(
    JSON.stringify({ message: 'throttled by client circuit breaker: runaway request loop guard', code: 'CLIENT_THROTTLED' }),
    { status: 429, headers: { 'Content-Type': 'application/json' } }
  ));

  return function breakerFetch(input, init) {
    const path = pathOf(input);
    if (path.startsWith('/rest/v1/')) { // guard data calls only — never auth/realtime/token
      const now = Date.now();
      if (now < (trippedUntil.get(path) || 0)) return throttled();
      let ts = windowByPath.get(path);
      if (!ts) { ts = []; windowByPath.set(path, ts); }
      const cutoff = now - WINDOW_MS;
      while (ts.length && ts[0] < cutoff) ts.shift();
      ts.push(now);
      if (ts.length > MAX_PER_WINDOW) {
        trippedUntil.set(path, now + COOLDOWN_MS);
        ts.length = 0;
        if (now - lastLoggedAt > 5000) {
          lastLoggedAt = now;
          try { console.error('[' + label + '] runaway request loop on ' + path + ' — short-circuiting ' + (COOLDOWN_MS / 1000) + 's. A render/effect re-fire bug is flooding this endpoint.'); } catch (_) { /* noop */ }
        }
        return throttled();
      }
    }
    return baseFetch(input, init);
  };
}
