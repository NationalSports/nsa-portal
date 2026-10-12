// Deploy-aware auto-reload.
//
// Browser tabs left open for hours/days keep running whatever JS bundle they first loaded.
// When many stale tabs accumulate they can hammer the API with outdated request patterns
// (e.g. auto-saving estimates they've drifted out of version-sync on, re-downloading whole
// tables), and there is otherwise no way to push fresh code into an already-open tab.
//
// This watcher fetches a tiny build fingerprint on a slow interval and, when it changes
// (a new build has been deployed), converges the tab on the current build. HOW it converges
// depends on the tab's health (2026-07-28 — reps reported "the portal boots me mid-work"
// during the July deploy cadence, when every merge force-reloaded every open tab within
// ~90s regardless of what the rep was doing):
//
//   - A STUCK tab (failed-save retry loop — `hasFailedSaves`) keeps the old aggressive
//     behavior: reload when safe, force past `maxDeferMs` even if never safe. A doomed
//     looping save will not succeed, and that is exactly the tab whose stale requests
//     hammer the API (the root cause of the recurring save_estimate storms).
//   - A HEALTHY tab is never yanked out from under an active user. It reloads only when
//     the save pipeline is quiet AND the user is idle (tab hidden / no recent input).
//     `onPendingReload` fires once at detection so the UI can show a "new version —
//     reload when ready" banner with a button. Past `idleDeadlineMs` (default 4h) the
//     user-idle requirement drops, but `isSafe` still holds — a healthy tab is never
//     reloaded mid-save no matter how old the pending build is.
//
// Every actual reload reports through `onReload(reason)` first (fire-and-forget
// telemetry), so forced reloads are measurable instead of anecdotal.
//
// Fingerprint source, in order of preference:
//   1. /build-meta.json     — written at build time with a unique id (changes on every
//                             deploy, including same-commit redeploys, so re-deploying is
//                             enough to force a fleet-wide reload). See scripts/write-build-meta.js.
//   2. /asset-manifest.json — CRA's content-hashed manifest, used if the stamp is absent.
//
// Paths are root-relative, so this runs for the internal portal (served at the app's own
// origin) and harmlessly no-ops where the file isn't served (e.g. the customer storefront
// proxy on the marketing domain returns 404 → no fingerprint → never reloads).

const META_URL = '/build-meta.json';
const ASSET_URL = '/asset-manifest.json';

let _started = false;
let _baseline = null;
let _committed = false; // once a new build is seen we commit to reloading; stop re-detecting

async function _fingerprint() {
  for (const url of [META_URL, ASSET_URL]) {
    try {
      const res = await fetch(url + '?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (!text) continue;
      try {
        const j = JSON.parse(text);
        if (url === META_URL && j && j.id != null) return 'meta:' + j.id;
        const entry = (j.files && (j.files['main.js'] || j.files['main.css']))
                   || (Array.isArray(j.entrypoints) && j.entrypoints.join(','));
        if (entry) return 'asset:' + entry;
      } catch {
        // Not JSON — fall back to a cheap content signature.
        return 'raw:' + text.length + ':' + text.slice(0, 80);
      }
    } catch {
      // Offline / fetch error — skip this source this cycle.
    }
  }
  return null;
}

/**
 * Begin watching for new deployments. Idempotent — safe to call more than once.
 * @param {Object} [opts]
 * @param {number} [opts.intervalMs=180000] How often to check for a new build (min 60s, default 3 min).
 * @param {() => boolean} [opts.isSafe] Save pipeline quiet? False defers the reload (e.g. a save is in flight).
 * @param {() => boolean} [opts.isBlocked] External operation active? Blocks every reload path, including deadlines and the banner button.
 * @param {() => boolean} [opts.hasUnsavedWork] Preserved drafts/pending edits? Blocks automatic reloads, including force deadlines.
 * @param {() => boolean} [opts.hasFailedSaves] Tab stuck in a failed-save loop? Only these tabs may be
 *   force-reloaded while unsafe (past maxDeferMs). Defaults to true, which preserves the pre-2026-07-28
 *   behavior for callers that don't distinguish.
 * @param {() => boolean} [opts.isUserIdle] User away from THIS tab (hidden / no recent input)? Healthy tabs
 *   wait for this before auto-reloading. Defaults to true (no user-activity gating).
 * @param {(reloadNow: () => void) => void} [opts.onPendingReload] Called once when a new build is detected —
 *   show a banner; call the passed function to reload immediately (reports reason 'user').
 * @param {(reason: string) => void} [opts.onReload] Telemetry hook, called just before every reload with
 *   'safe-idle' | 'stuck-forced' | 'deadline' | 'user'. Must not throw (wrapped anyway).
 * @param {number} [opts.maxDeferMs=90000] Stuck-tab force deadline (min 30s).
 * @param {number} [opts.idleDeadlineMs=14400000] Healthy-tab deadline (default 4h) after which the
 *   user-idle requirement drops. isSafe still holds past it.
 */
export function startDeployReloadWatcher(opts = {}) {
  if (_started || typeof window === 'undefined' || typeof fetch === 'undefined') return;
  _started = true;
  const intervalMs = Math.max(60000, opts.intervalMs || 180000);
  const isSafe = typeof opts.isSafe === 'function' ? opts.isSafe : () => true;
  // External writes must finish even if saves fail or the user requests a reload.
  const isBlocked = typeof opts.isBlocked === 'function' ? opts.isBlocked : () => false;
  const hasUnsavedWork = typeof opts.hasUnsavedWork === 'function' ? opts.hasUnsavedWork : () => false;
  const hasFailedSaves = typeof opts.hasFailedSaves === 'function' ? opts.hasFailedSaves : () => true;
  const isUserIdle = typeof opts.isUserIdle === 'function' ? opts.isUserIdle : () => true;
  const maxDeferMs = Math.max(30000, opts.maxDeferMs || 90000);
  const idleDeadlineMs = Math.max(maxDeferMs, opts.idleDeadlineMs || 4 * 60 * 60 * 1000);
  let _stuckDeadline = 0;   // past this, a failed-save tab reloads even while unsafe
  let _idleDeadline = 0;    // past this, a healthy tab reloads without waiting for user idle (isSafe still required)
  let _reloading = false;

  const doReload = (reason) => {
    if (_reloading || isBlocked() || (reason !== 'user' && hasUnsavedWork())) return;
    _reloading = true;
    try { if (typeof opts.onReload === 'function') opts.onReload(reason); } catch (_) { /* telemetry must never block the reload */ }
    // Small random delay so a fleet of tabs doesn't reload — and then re-fetch all data —
    // at the same instant, which would itself spike the DB. User-initiated reloads skip it.
    const jitter = reason === 'user' ? 0 : 2000 + Math.floor(Math.random() * 18000); // 2–20s
    setTimeout(() => {
      if (isBlocked() || (reason !== 'user' && hasUnsavedWork())) { _reloading = false; setTimeout(tick, 5000); return; }
      try { window.location.reload(); } catch (_) { /* noop */ }
    }, jitter);
  };

  // Seed the baseline from the same source we'll compare against, so a freshly-opened tab
  // never reloads on its first read.
  _fingerprint().then((fp) => { if (_baseline == null) _baseline = fp; });

  const tick = () => {
    if (_reloading) return;
    if (isBlocked() || hasUnsavedWork()) { setTimeout(tick, 5000); return; }
    if (isSafe() && isUserIdle()) { doReload('safe-idle'); return; }
    if (hasFailedSaves() && Date.now() >= _stuckDeadline) { doReload('stuck-forced'); return; }
    if (Date.now() >= _idleDeadline && isSafe()) { doReload('deadline'); return; }
    setTimeout(tick, 5000);
  };

  setInterval(async () => {
    if (_committed) return;
    const fp = await _fingerprint();
    if (fp == null) return;                       // couldn't read — try again next cycle
    if (_baseline == null) { _baseline = fp; return; }
    if (fp === _baseline) return;                 // same build — nothing to do
    _committed = true;
    _stuckDeadline = Date.now() + maxDeferMs;
    _idleDeadline = Date.now() + idleDeadlineMs;
    try { console.warn('[deploy-reload] new build detected — reloading when idle'); } catch (_) { /* noop */ }
    try { if (typeof opts.onPendingReload === 'function') opts.onPendingReload(() => doReload('user')); } catch (_) { /* noop */ }
    tick();
  }, intervalMs);
}

// Test-only: reset module state so each test starts a fresh watcher.
export function _resetDeployReloadForTests() { _started = false; _baseline = null; _committed = false; }

// ─── Stale-tab refresh (SO-2444, 2026-10-12) ───
//
// The deploy watcher above only fires when a NEW BUILD lands. A tab left open overnight with no
// deploy kept its overnight copy of every order, and the first edit in it was rejected as stale
// (another session had saved the order meanwhile). Returning to a tab after a long absence should
// look like opening it fresh: reload it — latest data and latest build — before the user acts.
//
// Rules, all of which must hold:
//   - the tab was hidden for STALE_TAB_MS, or the machine slept (a wall-clock gap of SLEEP_GAP_MS
//     between timer ticks — a laptop lid closed on a foreground tab never fires visibilitychange);
//   - the tab is visible again (never reload behind the user's back);
//   - it happens within RETURN_WINDOW_MS of coming back AND before any click/keypress/scroll —
//     once the user has started working, the tab is theirs (the July "boots me mid-work" lesson);
//   - no unsaved work, nothing blocking, and the save pipeline is quiet (same hooks as above).
export const STALE_TAB_MS = 3 * 60 * 60 * 1000;
export const SLEEP_GAP_MS = 30 * 60 * 1000;
export const RETURN_WINDOW_MS = 20 * 1000;

// Pure decision for the visibility/tick events: why this return counts as stale, or null.
export function staleTabReason({ now, hiddenAt = null, lastTickAt = null }) {
  if (hiddenAt != null && now - hiddenAt >= STALE_TAB_MS) return 'stale-hidden';
  if (lastTickAt != null && now - lastTickAt >= SLEEP_GAP_MS) return 'stale-wake';
  return null;
}

// Pure decision for each attempt while a stale return is pending.
export function staleReloadDecision({ now, returnedAt, lastInputAt = 0, visible, safe, blocked, unsaved }) {
  if (!visible) return 'wait';                                  // stays pending until the user is back
  if (returnedAt != null && lastInputAt > returnedAt) return 'cancel'; // user already started working
  if (returnedAt != null && now - returnedAt > RETURN_WINDOW_MS) return 'cancel';
  if (blocked || unsaved || !safe) return 'wait';
  return 'reload';
}

let _staleStarted = false;
export function startStaleTabReload(opts = {}) {
  if (_staleStarted || typeof window === 'undefined' || typeof document === 'undefined') return;
  _staleStarted = true;
  const isSafe = typeof opts.isSafe === 'function' ? opts.isSafe : () => true;
  const isBlocked = typeof opts.isBlocked === 'function' ? opts.isBlocked : () => false;
  const hasUnsavedWork = typeof opts.hasUnsavedWork === 'function' ? opts.hasUnsavedWork : () => false;
  let hiddenAt = document.hidden ? Date.now() : null;
  let lastTickAt = Date.now();
  let lastInputAt = 0;
  let pending = null;      // reason string while a stale return awaits a safe moment
  let returnedAt = null;   // when the tab became visible with `pending` set
  let retry = null;

  const attempt = () => {
    if (retry) { clearTimeout(retry); retry = null; }
    if (!pending) return;
    const visible = !document.hidden;
    if (visible && returnedAt == null) returnedAt = Date.now();
    const d = staleReloadDecision({ now: Date.now(), returnedAt, lastInputAt, visible,
      safe: isSafe(), blocked: isBlocked(), unsaved: hasUnsavedWork() });
    if (d === 'reload') {
      const reason = pending; pending = null;
      try { if (typeof opts.onReload === 'function') opts.onReload(reason); } catch (_) { /* telemetry never blocks */ }
      try { window.location.reload(); } catch (_) { /* noop */ }
      return;
    }
    if (d === 'cancel') { pending = null; returnedAt = null; return; }
    if (visible) retry = setTimeout(attempt, 1000);             // re-check within the return window
  };

  ['pointerdown', 'keydown', 'scroll'].forEach(ev => window.addEventListener(ev, () => { lastInputAt = Date.now(); }, { passive: true, capture: true }));
  document.addEventListener('visibilitychange', () => {
    const now = Date.now();
    if (document.hidden) { if (hiddenAt == null) hiddenAt = now; return; }
    const reason = staleTabReason({ now, hiddenAt });
    hiddenAt = null;
    if (reason && !pending) { pending = reason; returnedAt = now; }
    else if (pending && returnedAt == null) returnedAt = now;
    attempt();
  });
  setInterval(() => {
    const now = Date.now();
    const reason = staleTabReason({ now, lastTickAt });
    lastTickAt = now;
    if (reason && !pending) { pending = reason; returnedAt = document.hidden ? null : now; attempt(); }
  }, 60 * 1000);
}

export function _resetStaleTabReloadForTests() { _staleStarted = false; }
